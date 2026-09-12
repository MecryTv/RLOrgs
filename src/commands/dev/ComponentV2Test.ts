import { AttachmentBuilder, ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import ComponentV2Builder from "../../builder/ComponentV2Builder";

const SCOPE_FILE = `# Sprint 12 — Scope

- #12 Turnier-Bracket Rendering
- #14 Redis-Layer: TTL-Index-Leak fixen
- #15 Stripe-Connect Onboarding-Flow
`;

export default class ComponentV2Test extends Command {
    constructor(client: BotClient) {
        super(client, {
            name: "componentv2",
            description: "Testet den ComponentV2Builder",
            category: Category.Developer,
            cooldown: 5,
            developerOnly: true,
        });

        this.data = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .addStringOption((option) =>
                option
                    .setName("demo")
                    .setDescription("Welches Layout gezeigt werden soll (Standard: board)")
                    .addChoices(
                        { name: "Board — alle Komponenten", value: "board" },
                        { name: "Basic — Titel, Text, Thumbnail", value: "basic" },
                        { name: "Limits — Text-Kürzung auf 4000 Zeichen", value: "limits" }
                    )
            )
            .addBooleanOption((option) =>
                option.setName("ephemeral").setDescription("Nur für dich sichtbar (Standard: true)")
            );
    }

    async Execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const demo = interaction.options.getString("demo") ?? "board";
        const ephemeral = interaction.options.getBoolean("ephemeral") ?? true;
        const avatar = interaction.client.user.displayAvatarURL({ extension: "png", size: 256 });

        if (demo === "basic") {
            await interaction.reply(
                new ComponentV2Builder({ accentColor: "Blurple" })
                    .title("🧪 | Basic Demo", "Titel mit Subtitle, Separator und Thumbnail-Section")
                    .separator()
                    .section("Das hier ist eine Section mit **Thumbnail** rechts daneben.", {
                        type: "thumbnail",
                        url: avatar,
                        description: "Bot Avatar",
                    })
                    .subtext("Kleiner Footer-Text via .subtext()")
                    .toMessage({ ephemeral })
            );

            return;
        }

        if (demo === "limits") {
            await interaction.reply(
                new ComponentV2Builder({ accentColor: "Orange" })
                    .title("🧪 | Limit Demo", "5000 Zeichen rein, 4000 raus — der Rest wird gekürzt")
                    .separator()
                    .text("A".repeat(5000))
                    .toMessage({ ephemeral })
            );

            return;
        }

        const scope = new AttachmentBuilder(Buffer.from(SCOPE_FILE), { name: "sprint-12-scope.md" });
        const user = interaction.user.id;

        const board = new ComponentV2Builder({ accentColor: "#B57BFF" })
            .title("📋 Sprint 12 — Aufgabenplanung", "Zeitraum 11.08. – 24.08.2026 · zuletzt aktualisiert vor 12 Minuten")
            .progress(9, 15, { label: "erledigt" })
            .separator({ spacing: "large" })

            .section("## ✏️ In Arbeit\n-# 3 Aufgaben laufen gerade. Deadline in Klammern.", {
                type: "thumbnail",
                url: avatar,
                description: "Sprint Board",
            })
            .section(`\`#12\` **Turnier-Bracket Rendering**\n-# 🟡 In Arbeit · <@${user}> · fällig 18.08.2026`, {
                type: "button",
                customId: "sprint:details:12",
                label: "Details",
            })
            .section(`\`#14\` **Redis-Layer: TTL-Index-Leak fixen**\n-# 🟡 In Arbeit · <@${user}> · fällig 16.08.2026`, {
                type: "button",
                customId: "sprint:details:14",
                label: "Details",
            })
            .section(`\`#15\` **Stripe-Connect Onboarding-Flow**\n-# 🟡 In Review · <@${user}> · fällig 20.08.2026`, {
                type: "button",
                customId: "sprint:details:15",
                label: "Details",
            })
            .separator()

            .heading("☑️ Offen")
            .list([
                "`#16` Match-Reminder Scheduler — *frei* · 22.08.",
                "`#17` Admin-Dashboard: KPI-Charts — *frei* · 23.08.",
                "`#18` Docker-Compose für Prod-VPS — *frei* · 24.08.",
            ])
            .subtext("Freie Aufgaben kannst du dir unten selbst zuweisen.")
            .separator()

            .heading("✅ Erledigt")
            .list([
                "~~`#04` Zod Schemas für alle Redis-Models~~",
                "~~`#08` Slash-Command Cache~~",
                "~~`#11` Self Role Menü Doppelvergabe~~",
            ])
            .subtext("+ 6 weitere abgeschlossene Aufgaben")
            .separator()

            .heading("🕐 Zuletzt geändert")
            .list([
                `\`#12\` Status Offen → In Arbeit · <@${user}>`,
                "`#08` Deadline verschoben: 14.08. → **18.08.**",
                "`#04` auf **Erledigt** gesetzt",
            ])

            .file("sprint-12-scope.md")
            .select({
                customId: "sprint:claim",
                placeholder: "Aufgabe auswählen und übernehmen...",
                options: [
                    { label: "#16 Match-Reminder Scheduler", value: "16", description: "fällig 22.08.", emoji: "🗓️" },
                    { label: "#17 Admin-Dashboard: KPI-Charts", value: "17", description: "fällig 23.08.", emoji: "📊" },
                    { label: "#18 Docker-Compose für Prod-VPS", value: "18", description: "fällig 24.08.", emoji: "🐳" },
                ],
            })
            .buttons(
                { customId: "sprint:new", label: "Aufgabe anlegen", tone: "primary", emoji: "➕" },
                { customId: "sprint:done", label: "Als erledigt melden", tone: "success", emoji: "✅" },
                { customId: "sprint:refresh", label: "Aktualisieren", tone: "secondary", emoji: "🔄" }
            )
            .buttons({ url: "https://github.com/AscensionRL/Ascension-TS", label: "Board öffnen", emoji: "🔗" })
            .subtext("Board aktualisiert sich automatisch alle 15 Minuten · Fragen an das Dev-Team");

        await interaction.reply({ ...board.toMessage({ ephemeral }), files: [scope] });
    }
}
