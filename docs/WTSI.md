# WTSI — Weighted True Skill Index

Die Zahl hinter **Ø Club-MMR** und **Dein WTSI** in der Club-Karte. Für Spieler
erklärt sie das Dashboard selbst unter `/dashboard/docu#wtsi`; diese Datei ist die
Fassung für Entwickler.

Der Code steht in [`src/constants/WTSI.ts`](../src/constants/WTSI.ts).

---

## Das Problem

Ein Spieler hat drei Ränge, und keiner davon allein beantwortet die Frage „wie
stark ist der?".

| Naiver Ansatz | Warum er danebengeht |
|---|---|
| Höchste MMR nehmen | Belohnt den, der einen guten Tag hatte. Ein Ausreißer nach oben zählt voll. |
| Durchschnitt der drei | Wer 2v2 fast nie spielt, wird für die niedrige Zahl bestraft, obwohl sie nichts aussagt. |
| Nur aktuelle 3v3-MMR | Eine Pechsträhne wirft den ganzen Wert weg. |
| 1v1 einbeziehen | 1v1 ist ein anderes Spiel und sagt über Teamstärke wenig aus. |

WTSI nimmt **2v2 und 3v3**, gewichtet nach dem Peak des Spielers selbst, und
dämpft den Abstand zwischen aktuellem Stand und Peak.

## Die Rechnung

```
Rel_2s = Peak_2s / (Peak_2s + Peak_3s)      Gewicht des Modus
K_2s   = √(Current_2s / Peak_2s)            gedämpfte Konsistenz
TS_2s  = Peak_2s × K_2s                     Stärke in diesem Modus

WTSI   = TS_2s × Rel_2s + TS_3s × Rel_3s

Club-MMR = Durchschnitt der WTSI-Werte aller Mitglieder
```

### Warum der Peak die Basis ist

Die höchste je erreichte MMR verschwindet nicht, wenn ein Abend schiefgeht.
`player_ranks.peak_mmr` wächst nur und wird bei jedem Snapshot mitgeführt. Das
ist zugleich der Schutz gegen **Deranking**: wer sich absichtlich runterspielt,
behält seinen Peak und damit seinen WTSI weitgehend.

### Warum die Wurzel

Sie dämpft eine Pechsträhne, ohne sie zu ignorieren:

| Current / Peak | Faktor `K` | Verlust |
|---|---|---|
| 100 % | 1,000 | 0 % |
| 90 % | 0,949 | 5,1 % |
| 80 % | 0,894 | 10,6 % |
| 50 % | 0,707 | 29,3 % |
| 25 % | 0,500 | 50 % |

Ein schlechter Lauf drückt den Wert, wirft ihn aber nicht weg. Wer dauerhaft
weit unter seinem Peak bleibt, rutscht trotzdem deutlich.

### Warum die Gewichtung aus den Peaks kommt

Niemand legt fest, ob 2v2 oder 3v3 mehr zählt. Wer in 3v3 den höheren Peak hat,
wird stärker über 3v3 bewertet. Die eigene Spielhistorie bestimmt das Gewicht,
nicht eine Annahme im Code.

## Beispiel

| Modus | Current | Peak | `Rel` | `K` | `TS` | Beitrag |
|---|---|---|---|---|---|---|
| 2v2 | 1350 | 1400 | 0,519 | 0,982 | 1375 | 713 |
| 3v3 | 1180 | 1300 | 0,481 | 0,953 | 1239 | 596 |
| | | | | | **WTSI** | **1309** |

## Die drei Sonderfälle

Alle drei sind ausdrücklich abgefangen, weil sie sonst still danebengehen:

| Fall | Verhalten | Ohne Behandlung |
|---|---|---|
| Eine Playlist fehlt (Peak 0) | Die andere trägt allein | Teilen durch null → `NaN`, das sich durch jeden Durchschnitt zieht |
| Current über Peak | Current zählt als Peak | Faktor über 1, WTSI über dem tatsächlichen Peak |
| Spieler ohne Daten (WTSI 0) | Zählt im Schnitt nicht mit | Der Club-Schnitt wird von Unbekannten nach unten gezogen |

## Bekannte Einschränkung

Für **fremde Club-Mitglieder** kennt der Bot keinen Peak: Prime liefert über
`GetPlayersSkills` nur den aktuellen Stand. Die Rechnung läuft für sie mit
`current = peak`, der Wurzelterm wird damit zu 1 und der Deranking-Schutz fällt
weg. Für Nutzer mit verknüpftem Konto steht der echte Peak in `player_ranks`.

Wer das genauer will, müsste die Werte je Club-Mitglied mitschreiben, so wie
`player_ranks` es für eigene Nutzer tut. Der Code ist mit einem `ponytail:`-
Kommentar in [`PrimeService.ts`](../src/services/PrimeService.ts) markiert.

## Prüfung

`npm run check:db` rechnet die Formel gegen von Hand ermittelte Werte nach und
prüft alle drei Sonderfälle. Bricht die Rechnung, fällt der Lauf durch.
