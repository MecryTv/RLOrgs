import { randomInt } from "node:crypto";
import { ButtonInteraction, Guild, GuildMember, Message, MessageFlags } from "discord.js";
import BotClient from "../client/BotClient";
import { EntryCard, GiveawayCard, InfoCard, WinnerAnnouncement, WinnerDm } from "../builder/CommunityView";
import { DayOf } from "../constants/Activity";
import {
    CLAIM_CHOICES,
    DefaultGiveawaySettings,
    DefaultRequirements,
    GIVEAWAY_ACCENT,
    MAX_BONUS_ROLES,
    MAX_BONUS_TICKETS,
    MAX_GIVEAWAY_DESCRIPTION,
    MAX_GIVEAWAY_SECONDS,
    MAX_PRIZE,
    MAX_SCHEDULE_AHEAD,
    MAX_WINNERS,
    MIN_GIVEAWAY_SECONDS,
} from "../constants/Giveaways";
import { IGiveaway, IGiveawayBonus, IGiveawayRequirements, IGiveawaySettings, IGiveawayWinner } from "../interfaces/services/community/ICommunity";
import { NewGiveaway } from "../models/Giveaways";
import logger from "../utils/logger";
import { IsLogTarget, WarmLogTarget } from "../utils/logtarget";

export class GiveawayError extends Error {}

export const GIVEAWAYS_MODULE = "giveaways";
/** Die Pseudo-Rolle für Server-Booster bei den Bonus-Losen - Discords Booster-Rolle ist verwaltet und nicht wählbar. */
export const BOOSTER = "booster";

const DAY = 86_400_000;
const REDRAW_MS = 5_000;

function IsRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function Int(value: unknown, min: number, max: number, fallback: number): number {
    const number = Math.floor(Number(value));

    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

/**
 * Wählt count Gewinner, je Los eine Chance - ohne Zurücklegen. pick bekommt
 * den Kandidaten und sagt, ob er gilt (noch Mitglied, Bedingungen erfüllt).
 */
export async function DrawWeighted(
    entries: { user_id: string; tickets: number }[],
    count: number,
    pick: (userId: string) => Promise<boolean>
): Promise<string[]> {
    const pool = entries.map((entry) => ({ id: entry.user_id, weight: Math.max(1, entry.tickets) }));
    const winners: string[] = [];

    while (winners.length < count && pool.length) {
        const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
        let roll = randomInt(total);
        let index = 0;

        while (roll >= pool[index].weight) roll -= pool[index++].weight;

        const [candidate] = pool.splice(index, 1);

        if (await pick(candidate.id)) winners.push(candidate.id);
    }

    return winners;
}

/**
 * Giveaways: planen, starten, mitmachen (mit Bedingungen und Bonus-Losen),
 * auslosen, Gewinner per DM mit Frist - wer sich nicht meldet, wird ersetzt.
 * Siehe docs/Giveaways.md.
 */
export default class GiveawayService {
    private readonly client: BotClient;
    private readonly redraws = new Map<number, NodeJS.Timeout>();
    // Endet ein Giveaway in der nächsten Minute, endet es pünktlich - nicht erst beim nächsten Lauf.
    private readonly timers = new Map<number, NodeJS.Timeout>();

    constructor(client: BotClient) {
        this.client = client;
    }

    /* ----------------------------------------------------------
       Erstellen
       ---------------------------------------------------------- */
    CleanRequirements(guild: Guild, input: unknown): IGiveawayRequirements {
        const raw = IsRecord(input) ? input : {};
        const roles = (value: unknown): string[] =>
            Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && guild.roles.cache.has(id) && id !== guild.id))].slice(0, 10) : [];
        const base = DefaultRequirements();

        return {
            roles: roles(raw.roles),
            allRoles: raw.allRoles === true,
            forbidden: roles(raw.forbidden),
            booster: raw.booster === "only" || raw.booster === "none" ? raw.booster : base.booster,
            serverDays: Int(raw.serverDays, 0, 3650, 0),
            accountDays: Int(raw.accountDays, 0, 3650, 0),
            messages: Int(raw.messages, 0, 10_000, 0),
            linked: raw.linked === true,
        };
    }

    CleanBonus(guild: Guild, input: unknown): IGiveawayBonus[] {
        if (!Array.isArray(input)) return [];

        const seen = new Set<string>();
        const bonus: IGiveawayBonus[] = [];

        for (const raw of input) {
            if (!IsRecord(raw) || typeof raw.roleId !== "string" || seen.has(raw.roleId)) continue;
            if (raw.roleId !== BOOSTER && (!guild.roles.cache.has(raw.roleId) || raw.roleId === guild.id)) continue;

            seen.add(raw.roleId);
            bonus.push({ roleId: raw.roleId, tickets: Int(raw.tickets, 1, MAX_BONUS_TICKETS, 1) });
        }

        return bonus.slice(0, MAX_BONUS_ROLES);
    }

    CleanSettings(guild: Guild, input: unknown): IGiveawaySettings {
        const raw = IsRecord(input) ? input : {};
        const base = DefaultGiveawaySettings();
        const claim = Number(raw.claimHours);

        return {
            dm: typeof raw.dm === "boolean" ? raw.dm : base.dm,
            claimHours: CLAIM_CHOICES.includes(claim) ? claim : base.claimHours,
            ping: raw.ping === "everyone" || raw.ping === "here" || (typeof raw.ping === "string" && guild.roles.cache.has(raw.ping) && raw.ping !== guild.id) ? raw.ping : null,
            accent: typeof raw.accent === "string" && /^#[0-9a-f]{6}$/i.test(raw.accent) ? raw.accent.toLowerCase() : null,
        };
    }

    /** Aus Dashboard oder Befehl ein gültiges Giveaway - ein Fehler sagt, was fehlt. */
    Clean(guild: Guild, hostId: string, input: unknown): NewGiveaway {
        if (!IsRecord(input)) throw new GiveawayError("Das ist kein Giveaway.");

        const prize = typeof input.prize === "string" ? input.prize.trim() : "";
        const channelId = typeof input.channelId === "string" ? input.channelId : "";
        const now = Date.now();
        const startsAt = input.startsAt === null || input.startsAt === undefined ? now : Math.floor(Number(input.startsAt));
        const duration = Math.floor(Number(input.duration));

        if (!prize) throw new GiveawayError("Was gibt es zu gewinnen? Der Preis fehlt.");
        if (prize.length > MAX_PRIZE) throw new GiveawayError(`Der Preis darf höchstens ${MAX_PRIZE} Zeichen haben.`);
        if (!IsLogTarget(guild.channels.cache.get(channelId))) throw new GiveawayError("Wähle einen Kanal für das Giveaway.");
        if (!Number.isFinite(startsAt) || startsAt < now - 60_000 || startsAt > now + MAX_SCHEDULE_AHEAD) {
            throw new GiveawayError("Der Start liegt in der Vergangenheit oder mehr als 90 Tage entfernt.");
        }
        if (!Number.isFinite(duration) || duration < MIN_GIVEAWAY_SECONDS || duration > MAX_GIVEAWAY_SECONDS) {
            throw new GiveawayError("Ein Giveaway läuft mindestens eine Minute und höchstens 60 Tage.");
        }

        const image = typeof input.image === "string" && input.image.startsWith("https://") && URL.canParse(input.image) ? input.image.slice(0, 512) : null;
        const scheduled = startsAt > now + 60_000;

        return {
            guildId: guild.id,
            channelId,
            prize,
            description: typeof input.description === "string" ? input.description.trim().slice(0, MAX_GIVEAWAY_DESCRIPTION) || null : null,
            image,
            winners: Int(input.winners, 1, MAX_WINNERS, 1),
            hostId,
            status: scheduled ? "scheduled" : "running",
            startsAt: scheduled ? startsAt : now,
            endsAt: (scheduled ? startsAt : now) + duration * 1000,
            requirements: this.CleanRequirements(guild, input.requirements),
            bonus: this.CleanBonus(guild, input.bonus),
            settings: this.CleanSettings(guild, input.settings),
        };
    }

    async Create(guild: Guild, host: GuildMember, input: unknown): Promise<IGiveaway> {
        if (IsRecord(input)) await WarmLogTarget(guild, input.channelId);

        const giveaway = await this.client.giveaways.Create(this.Clean(guild, host.id, input));

        logger.user(`🎉 Giveaway #${giveaway.number} auf ${guild.id} ${giveaway.status === "scheduled" ? "geplant" : "gestartet"} (von ${host.id})`);

        return giveaway.status === "running" ? this.Start(giveaway) : giveaway;
    }

    /** Schickt die Karte in den Kanal - sofort oder zum geplanten Zeitpunkt. */
    private async Start(giveaway: IGiveaway): Promise<IGiveaway> {
        const guild = this.client.guilds.cache.get(giveaway.guildId);
        const channel = guild ? (guild.channels.cache.get(giveaway.channelId) ?? (await guild.channels.fetch(giveaway.channelId).catch(() => null))) : null;

        if (!guild || !channel?.isTextBased()) {
            await this.client.giveaways.Patch(giveaway.id, { status: "cancelled", endedAt: Date.now() });

            throw new GiveawayError("Den Kanal des Giveaways gibt es nicht mehr.");
        }

        // Ein geplantes Giveaway läuft ab jetzt so lange, wie es geplant war.
        const length = giveaway.endsAt - giveaway.startsAt;
        const running = { ...giveaway, status: "running" as const, startsAt: Date.now(), endsAt: Date.now() + length };
        const message = await channel.send({ ...GiveawayCard(running, 0, this.Rules(guild, running), this.BonusLines(guild, running)), flags: MessageFlags.IsComponentsV2 }).catch(() => null);

        if (!message) {
            await this.client.giveaways.Patch(giveaway.id, { status: "cancelled", endedAt: Date.now() });

            throw new GiveawayError("Das Giveaway ging nicht raus – darf der Bot in den Kanal schreiben?");
        }

        return (await this.client.giveaways.Patch(giveaway.id, { status: "running", messageId: message.id, startsAt: running.startsAt, endsAt: running.endsAt }))!;
    }

    /* ----------------------------------------------------------
       Bedingungen
       ---------------------------------------------------------- */
    /** Die Bedingungen als Sätze - auf der Karte und im Dashboard. */
    Rules(guild: Guild, giveaway: Pick<IGiveaway, "requirements">): string[] {
        const { requirements } = giveaway;
        const role = (id: string): string => `<@&${id}>`;
        const rules: string[] = [];

        if (requirements.roles.length) {
            rules.push(`${requirements.allRoles && requirements.roles.length > 1 ? "Alle diese Rollen" : requirements.roles.length > 1 ? "Eine dieser Rollen" : "Die Rolle"}: ${requirements.roles.map(role).join(", ")}`);
        }

        if (requirements.forbidden.length) rules.push(`Nicht mit: ${requirements.forbidden.map(role).join(", ")}`);
        if (requirements.booster === "only") rules.push("Nur für Server-Booster");
        if (requirements.booster === "none") rules.push("Keine Server-Booster");
        if (requirements.serverDays) rules.push(`Mindestens ${requirements.serverDays} ${requirements.serverDays === 1 ? "Tag" : "Tage"} auf ${guild.name}`);
        if (requirements.accountDays) rules.push(`Discord-Konto älter als ${requirements.accountDays} ${requirements.accountDays === 1 ? "Tag" : "Tage"}`);
        if (requirements.messages) rules.push(`Mindestens ${requirements.messages} Nachrichten in den letzten 14 Tagen`);
        if (requirements.linked) rules.push("Verknüpftes Rocket-League-Konto (Dashboard › Einstellungen)");

        return rules;
    }

    BonusLines(guild: Guild, giveaway: Pick<IGiveaway, "bonus">): string[] {
        return giveaway.bonus.map((bonus) => `${bonus.roleId === BOOSTER ? "Server-Booster" : `<@&${bonus.roleId}>`}: +${bonus.tickets} ${bonus.tickets === 1 ? "Los" : "Lose"}`);
    }

    /** Was einem Mitglied noch fehlt - leer: er darf mitmachen. */
    async Missing(member: GuildMember, requirements: IGiveawayRequirements): Promise<string[]> {
        const missing: string[] = [];
        const now = Date.now();
        const name = (id: string): string => `@${member.guild.roles.cache.get(id)?.name ?? "Rolle"}`;

        if (requirements.roles.length) {
            const ok = requirements.allRoles
                ? requirements.roles.every((id) => member.roles.cache.has(id))
                : requirements.roles.some((id) => member.roles.cache.has(id));

            if (!ok) missing.push(`Dir fehlt ${requirements.allRoles ? "eine der Pflicht-Rollen" : "die Rolle"} ${requirements.roles.filter((id) => !member.roles.cache.has(id)).map(name).join(", ")}.`);
        }

        const blocked = requirements.forbidden.filter((id) => member.roles.cache.has(id));

        if (blocked.length) missing.push(`Mit ${blocked.map(name).join(", ")} kannst du nicht mitmachen.`);
        if (requirements.booster === "only" && !member.premiumSince) missing.push("Nur für Server-Booster.");
        if (requirements.booster === "none" && member.premiumSince) missing.push("Server-Booster sind hier ausgenommen.");

        if (requirements.serverDays && now - (member.joinedTimestamp ?? now) < requirements.serverDays * DAY) {
            const left = Math.ceil((requirements.serverDays * DAY - (now - (member.joinedTimestamp ?? now))) / DAY);

            missing.push(`Du musst ${requirements.serverDays} Tage auf dem Server sein – noch ${left} ${left === 1 ? "Tag" : "Tage"}.`);
        }

        if (requirements.accountDays && now - member.user.createdTimestamp < requirements.accountDays * DAY) {
            missing.push(`Dein Discord-Konto muss älter als ${requirements.accountDays} Tage sein.`);
        }

        if (requirements.messages && this.client.databaseService.Ready) {
            const written = await this.client.activity.MemberMessages(member.guild.id, member.id, DayOf(now) - 13).catch(() => 0);

            if (written < requirements.messages) missing.push(`Du brauchst ${requirements.messages} Nachrichten in den letzten 14 Tagen – bisher ${written}.`);
        }

        if (requirements.linked && !(await this.client.accounts.On(member.id, "epic").catch(() => null))) {
            missing.push("Verknüpfe zuerst dein Rocket-League-Konto im Dashboard unter Einstellungen.");
        }

        return missing;
    }

    /** Ein Los plus die Bonus-Lose seiner Rollen. */
    Tickets(member: GuildMember, bonus: IGiveawayBonus[]): number {
        return 1 + bonus.reduce((sum, entry) => sum + ((entry.roleId === BOOSTER ? member.premiumSince : member.roles.cache.has(entry.roleId)) ? entry.tickets : 0), 0);
    }

    /* ----------------------------------------------------------
       Mitmachen
       ---------------------------------------------------------- */
    async Join(interaction: ButtonInteraction, id: number): Promise<void> {
        const giveaway = await this.client.giveaways.Get(id);
        const reply = (text: string, accent = GIVEAWAY_ACCENT) => interaction.reply({ ...InfoCard(text, accent), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

        if (!giveaway || giveaway.status !== "running" || giveaway.endsAt <= Date.now() || giveaway.guildId !== interaction.guildId) {
            await reply("Dieses Giveaway ist vorbei.", "#6b7683");

            return;
        }

        const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild!.members.fetch(interaction.user.id);
        const entry = await this.client.giveaways.Entry(giveaway.id, member.id);

        if (entry) {
            const text = `✅ Du bist schon dabei – mit **${entry.tickets} ${entry.tickets === 1 ? "Los" : "Losen"}**. Ausgelost wird <t:${Math.floor(giveaway.endsAt / 1000)}:R>.`;

            await interaction.reply({ ...EntryCard(text, giveaway.id), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

            return;
        }

        const missing = await this.Missing(member, giveaway.requirements);

        if (missing.length) {
            await reply(`❌ Noch nicht:\n${missing.map((line) => `• ${line}`).join("\n")}`, "#ff4d5e");

            return;
        }

        const tickets = this.Tickets(member, giveaway.bonus);

        await this.client.giveaways.Join(giveaway.id, member.id, tickets);
        await reply(`🎉 Du bist dabei – mit **${tickets} ${tickets === 1 ? "Los" : "Losen"}**. Viel Glück! Ausgelost wird <t:${Math.floor(giveaway.endsAt / 1000)}:R>.`);
        this.Redraw(giveaway.id);
    }

    async Leave(interaction: ButtonInteraction, id: number): Promise<void> {
        const giveaway = await this.client.giveaways.Get(id);

        if (giveaway?.status === "running") {
            await this.client.giveaways.Leave(giveaway.id, interaction.user.id);
            this.Redraw(giveaway.id);
        }

        await interaction.update({ ...InfoCard(giveaway?.status === "running" ? "Du bist ausgetragen." : "Dieses Giveaway ist vorbei.", "#6b7683"), flags: MessageFlags.IsComponentsV2 });
    }

    /** Die DM-Knopf "Gewinn annehmen". */
    async Claim(interaction: ButtonInteraction, id: number): Promise<void> {
        const giveaway = await this.client.giveaways.Get(id);
        const winner = giveaway?.results.winners.find((entry) => entry.userId === interaction.user.id && entry.status === "pending");
        const answer = (text: string) => interaction.update({ ...InfoCard(text, GIVEAWAY_ACCENT), flags: MessageFlags.IsComponentsV2 });

        if (!giveaway || !winner) {
            await answer("Dieser Gewinn ist schon angenommen – oder die Frist ist vorbei.");

            return;
        }

        if (winner.deadline && winner.deadline < Date.now()) {
            await answer("Die Frist ist leider abgelaufen – es wurde neu ausgelost.");

            return;
        }

        winner.status = "claimed";
        winner.claimedAt = Date.now();

        const saved = await this.client.giveaways.Patch(giveaway.id, { results: giveaway.results });

        await answer(`✅ Angenommen! **${giveaway.prize}** gehört dir – das Team meldet sich bei dir.`);

        if (saved) await this.Render(saved);

        logger.user(`🎉 Giveaway #${giveaway.number} auf ${giveaway.guildId}: Gewinn von ${interaction.user.id} angenommen`);
    }

    /* ----------------------------------------------------------
       Karte
       ---------------------------------------------------------- */
    Redraw(id: number): void {
        if (this.redraws.has(id)) return;

        this.redraws.set(
            id,
            setTimeout(() => {
                this.redraws.delete(id);
                void this.client.giveaways.Get(id).then((giveaway) => (giveaway ? this.Render(giveaway) : undefined)).catch(() => undefined);
            }, REDRAW_MS)
        );
    }

    private async MessageOf(giveaway: IGiveaway): Promise<Message | null> {
        const guild = this.client.guilds.cache.get(giveaway.guildId);
        const channel = guild ? (guild.channels.cache.get(giveaway.channelId) ?? (await guild.channels.fetch(giveaway.channelId).catch(() => null))) : null;

        if (!channel?.isTextBased() || !giveaway.messageId) return null;

        return channel.messages.fetch(giveaway.messageId).catch(() => null);
    }

    private async Render(giveaway: IGiveaway): Promise<void> {
        const guild = this.client.guilds.cache.get(giveaway.guildId);
        const message = guild ? await this.MessageOf(giveaway) : null;

        if (!guild || !message) return;

        const view = GiveawayCard(giveaway, await this.client.giveaways.EntryCount(giveaway.id), this.Rules(guild, giveaway), this.BonusLines(guild, giveaway));

        await message.edit({ components: view.components, allowedMentions: { parse: [] } }).catch(() => undefined);
    }

    /* ----------------------------------------------------------
       Auslosen
       ---------------------------------------------------------- */
    /** Neue Gewinner, die noch Mitglied sind und die Bedingungen weiter erfüllen. */
    private async Draw(guild: Guild, giveaway: IGiveaway, count: number): Promise<IGiveawayWinner[]> {
        const taken = new Set(giveaway.results.winners.map((winner) => winner.userId));
        const entries = (await this.client.giveaways.Entries(giveaway.id)).filter((entry) => !taken.has(entry.user_id));
        const ids = await DrawWeighted(entries, count, async (userId) => {
            const member = await guild.members.fetch(userId).catch(() => null);

            return Boolean(member) && (await this.Missing(member!, giveaway.requirements)).length === 0;
        });
        const claim = giveaway.settings.dm && giveaway.settings.claimHours > 0;

        return ids.map((userId) => ({
            userId,
            drawnAt: Date.now(),
            deadline: claim ? Date.now() + giveaway.settings.claimHours * 3_600_000 : null,
            status: claim ? "pending" : "won",
            claimedAt: null,
            dm: null,
        }));
    }

    private async Notify(guild: Guild, giveaway: IGiveaway, winners: IGiveawayWinner[]): Promise<void> {
        if (!giveaway.settings.dm) return;

        for (const winner of winners) {
            const user = await this.client.users.fetch(winner.userId).catch(() => null);

            winner.dm = user
                ? await user
                      .send({ ...WinnerDm(giveaway, guild.name, winner.deadline), flags: MessageFlags.IsComponentsV2 })
                      .then(() => true)
                      .catch(() => false)
                : false;
        }
    }

    private async Announce(giveaway: IGiveaway, userIds: string[], reroll: boolean): Promise<void> {
        const message = await this.MessageOf(giveaway);

        await message?.reply({ ...WinnerAnnouncement(giveaway, userIds, reroll), flags: MessageFlags.IsComponentsV2 }).catch(() => undefined);
    }

    /** Beendet ein Giveaway und lost aus - auch vorzeitig aus dem Dashboard. */
    async End(giveaway: IGiveaway): Promise<IGiveaway> {
        if (giveaway.status !== "running") throw new GiveawayError("Dieses Giveaway läuft nicht.");

        const guild = this.client.guilds.cache.get(giveaway.guildId);

        if (!guild) throw new GiveawayError("Der Bot ist auf diesem Server nicht mehr.");

        // Zuerst als beendet markieren - so lost niemand doppelt aus, auch nicht der Timer.
        const ended = (await this.client.giveaways.Patch(giveaway.id, { status: "ended", endedAt: Date.now() }))!;
        const winners = await this.Draw(guild, ended, ended.winners);

        await this.Notify(guild, ended, winners);

        const done = (await this.client.giveaways.Patch(ended.id, { results: { winners } }))!;

        await this.Render(done);
        await this.Announce(done, winners.map((winner) => winner.userId), false);
        logger.user(`🎉 Giveaway #${done.number} auf ${done.guildId} ausgelost: ${winners.length} Gewinner`);

        return done;
    }

    /**
     * Lost neu aus: für einen bestimmten Gewinner, für alle, die noch nicht
     * angenommen haben ("all"), oder für die mit verpasster Frist ("expired").
     */
    async Reroll(giveaway: IGiveaway, target: string): Promise<IGiveaway> {
        if (giveaway.status !== "ended") throw new GiveawayError("Neu auslosen geht erst, wenn das Giveaway beendet ist.");

        const guild = this.client.guilds.cache.get(giveaway.guildId);

        if (!guild) throw new GiveawayError("Der Bot ist auf diesem Server nicht mehr.");

        const out = giveaway.results.winners.filter((winner) =>
            target === "expired"
                ? winner.status === "expired"
                : target === "all"
                  ? winner.status === "won" || winner.status === "pending" || winner.status === "expired"
                  : winner.userId === target && winner.status !== "replaced"
        );

        if (out.length === 0) throw new GiveawayError(target === "all" || target === "expired" ? "Es gibt keinen Platz neu zu vergeben." : "Dieser User ist kein aktueller Gewinner.");

        for (const winner of out) winner.status = "replaced";

        const fresh = await this.Draw(guild, giveaway, out.length);

        await this.Notify(guild, giveaway, fresh);

        const saved = (await this.client.giveaways.Patch(giveaway.id, { results: { winners: [...giveaway.results.winners, ...fresh] } }))!;

        await this.Render(saved);
        await this.Announce(saved, fresh.map((winner) => winner.userId), true);

        return saved;
    }

    async Cancel(giveaway: IGiveaway): Promise<IGiveaway> {
        if (giveaway.status !== "running" && giveaway.status !== "scheduled") throw new GiveawayError("Dieses Giveaway ist schon vorbei.");

        const cancelled = (await this.client.giveaways.Patch(giveaway.id, { status: "cancelled", endedAt: Date.now() }))!;

        await this.Render(cancelled);

        return cancelled;
    }

    async Delete(giveaway: IGiveaway): Promise<void> {
        const message = await this.MessageOf(giveaway);

        await message?.delete().catch(() => undefined);
        await this.client.giveaways.Remove(giveaway.id);
    }

    /* ----------------------------------------------------------
       Jede Minute
       ---------------------------------------------------------- */
    async RunDue(): Promise<void> {
        if (!this.client.databaseService.Ready) return;

        const now = Date.now();

        for (const giveaway of await this.client.giveaways.Pending(now + 65_000)) {
            try {
                if (giveaway.status === "scheduled" && giveaway.startsAt <= now) {
                    await this.Start(giveaway);
                } else if (giveaway.status === "running") {
                    this.Schedule(giveaway);
                } else if (giveaway.status === "ended") {
                    await this.Expire(giveaway, now);
                }
            } catch (error) {
                logger.warn(`🎉 Giveaway ${giveaway.id} - ${String(error)}`);
            }
        }
    }

    /** Pünktlich enden: ein Timer auf die Sekunde statt bis zum nächsten Lauf. */
    private Schedule(giveaway: IGiveaway): void {
        if (this.timers.has(giveaway.id)) return;

        this.timers.set(
            giveaway.id,
            setTimeout(
                () => {
                    this.timers.delete(giveaway.id);
                    void this.client.giveaways
                        .Get(giveaway.id)
                        .then((fresh) => (fresh?.status === "running" ? this.End(fresh) : undefined))
                        .catch((error) => logger.warn(`🎉 Giveaway ${giveaway.id} nicht beendet - ${String(error)}`));
                },
                Math.max(0, giveaway.endsAt - Date.now())
            )
        );
    }

    /** Wer seine Frist verpasst, wird ersetzt. */
    private async Expire(giveaway: IGiveaway, now: number): Promise<void> {
        const late = giveaway.results.winners.filter((winner) => winner.status === "pending" && winner.deadline !== null && winner.deadline < now);

        if (late.length === 0) return;

        for (const winner of late) winner.status = "expired";

        await this.client.giveaways.Patch(giveaway.id, { results: giveaway.results });
        await this.Reroll((await this.client.giveaways.Get(giveaway.id))!, "expired").catch(async () => {
            // Keiner mehr übrig: dann bleibt es bei den Abgelaufenen.
            const fresh = await this.client.giveaways.Get(giveaway.id);

            if (fresh) await this.Render(fresh);
        });
    }
}
