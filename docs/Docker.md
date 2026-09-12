# Docker

MariaDB und phpMyAdmin laufen in Containern — statt XAMPP. Die Beschreibung steht in `docker-compose.yml` im Projekt-Root.

> **Warum der Wechsel:** die Aria-Systemtabellen von XAMPP (`mysql.db`, `mysql.global_priv`) gingen wiederholt kaputt und mussten von Hand repariert werden. Der Container startet jedes Mal mit demselben, geprüften Zustand.

---

## Voraussetzungen

* **WSL 2** — bei Windows 11 vorhanden. Prüfen mit `wsl --status`
* **Docker Desktop** — `winget install Docker.DockerDesktop`, danach einmal starten und die Lizenz annehmen

---

## Starten und stoppen

```bash
docker compose up -d      # startet MariaDB und phpMyAdmin
docker compose ps         # zeigt den Zustand
docker compose logs -f    # sieht beim Starten zu
docker compose down       # stoppt beide, die Daten bleiben
```

| Dienst | Adresse |
|---|---|
| MariaDB | `localhost:3306` |
| phpMyAdmin | <http://localhost:8080> |

Beide Ports hängen an `127.0.0.1` — aus dem Netz ist nichts davon erreichbar.

**Anmelden in phpMyAdmin:** entweder als `rlnexus` mit `DATABASE_PASSWORD` (sieht nur die eigene Datenbank) oder als `root` mit `DATABASE_ROOT_PASSWORD` (sieht alles).

---

## Zugangsdaten

Der Container liest dieselbe `.env` wie der Bot. Beim **ersten** Start legt er Datenbank und Nutzer daraus an:

| Variable | Wofür |
|---|---|
| `DATABASE_NAME` | Name der Datenbank, die angelegt wird |
| `DATABASE_USER` / `DATABASE_PASSWORD` | Der Nutzer, mit dem der Bot arbeitet |
| `DATABASE_ROOT_PASSWORD` | Root-Konto des Containers, nur für phpMyAdmin |
| `DATABASE_PORT` | Auf welchem Port MariaDB herausschaut |

> **Nur beim ersten Start.** Danach liegen Nutzer und Passwörter im Datenträger `mariadb-data`. Ein geändertes Passwort in der `.env` ändert dort nichts — das muss dann in der Datenbank selbst geschehen (oder `docker compose down -v`, was **alle Daten löscht**).

---

## Wo die Daten liegen

Im benannten Volume `rlorgs_mariadb-data`, verwaltet von Docker. Es überlebt `docker compose down` und Neustarts.

```bash
docker volume ls                       # zeigt es an
docker compose down -v                 # löscht es MIT ALLEN DATEN
```

Ein Abzug für unterwegs:

```bash
docker exec rlnexus-mariadb mariadb-dump -u root -p"$DATABASE_ROOT_PASSWORD" rlnexus > sicherung.sql
```

---

## Wenn etwas nicht stimmt

| Meldung | Ursache |
|---|---|
| `docker-credential-desktop not found` | Docker Desktop läuft, aber sein `bin` fehlt im PATH. Neues Terminal öffnen |
| `Ports are not available: 3306` | Etwas anderes hält den Port — meist noch XAMPP. Dort MySQL stoppen |
| `DATABASE_PASSWORD fehlt in der .env` | Die Compose-Datei bricht bewusst ab, statt mit leerem Passwort zu starten |
| `Container is unhealthy` | MariaDB braucht beim ersten Start eine halbe Minute. `docker compose logs mariadb` zeigt, woran es liegt |

Steht alles, prüft der übliche Lauf den Rest:

```bash
npm run check:db
```
