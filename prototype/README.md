# expressCARD — štrukturálny Guest mode prototyp

Tento adresár obsahuje **izolovaný štrukturálny a Motion prototyp** verejného Guest mode produktu expressCARD.

**Nie je to** produkčná šablóna, produkčný renderer, editor, publikačný balík ani zdroj pravdy pre kartu. Overuje vizuálny model z `expressCARD_EDITOR_CONTRACT.md` bez implementácie editora, JSON kontraktu, databázy ani produkčného rendereru.

V tejto fáze **sa nesmie nasadiť do koreňa aktívnej domény** `expresscard.eu`.

## Účel

Prototyp overuje:

- dve globálne vrstvy pozadia a samostatnú atmosphere/odlesk vrstvu,
- tri obsahové sekcie s výškou podľa obsahu,
- vlastné povrchy sekcií a jeden kontrolovaný tvarovaný prechod,
- rozdelenie existujúceho obsahu do logických modulov,
- odstupňované Motion roly (media, action, icon, background, static),
- jemný gyro/pointer pohyb CTA a kontaktných ikon,
- pevný systémový podpis `expressCARD`,
- responzívne správanie na mobile a desktope,
- `prefers-reduced-motion` a statický fallback bez JavaScriptu.

## Vytvorená štruktúra

```text
prototype/
├── index.html
├── owner.html
├── README.md
└── assets/
    ├── css/
    │   └── expresscard-prototype.css
    └── js/
        ├── expresscard-motion.js
        └── expresscard-owner.js
```

Systémový SVG podpis používa existujúci asset `/images/expressCARD_App.svg` v päte Guest aj Owner mode (spoločný mechanizmus `.ec-footer__mark`, `data-ec-system-signature="expresscard"`). Horný Guest lockup spája `/images/expressar_icon.svg` s textom `expressCARD`. SVG dodáva používateľ; prototyp ich nevytvára ani neupravuje. Guest rýchle kontakty a sociálne kanály používajú CSS masky dodaných SVG (`core-outline` a `brands`). Tlačidlo **Aktivovať pohyb** používa `assets/icons/sets/core-outline/motion.svg`. Owner mode **nekreslí** nové SVG; chýbajúce akčné ikony majú textový fallback. Spoločné korporátne tokeny (`--ec-brand`, `--ec-brand-soft`, `--ec-brand-border`, `--ec-brand-gradient`, `--ec-brand-on-gradient`) sú zdroj vizuálneho defaultu; Guest ich číta cez `--ec-guest-*`, Owner cez `--ec-owner-*`. Na gradientových Owner tlačidlách majú `:hover` (iba `@media (hover: hover)`) a `:focus-visible` spoločnú farbu textu aj maskovaných SVG ikon `var(--ec-owner-brand)`.

Relatívne cesty (`assets/css/...`, `assets/js/...`) sú pripravené pre lokálne overenie aj budúce testovacie umiestnenie `/preview/`.

Cache verzie assetov:

- Guest CSS: `index.html` → `?v=20260829-motion-icon1`
- Guest JS: `expresscard-motion.js?v=20260829-motion-icon1`
- Owner: `owner.html` → CSS/JS `?v=20260829-guest-default1`

## Ako otvoriť lokálne

1. V Cursor / VS Code otvorte súbor `prototype/index.html`.
2. Spustite **Live Server** (alebo ekvivalentný lokálny statický server) z tohto adresára.
3. Overte najprv mobilný Guest mode, potom desktopovú centrovanú kompozíciu.

Odporúčané overenie:

- `http://127.0.0.1:<port>/index.html`
- `http://127.0.0.1:<port>/index.html?debug=1`
- `http://127.0.0.1:<port>/owner.html`
- `http://127.0.0.1:<port>/owner.html?debug=1`

HTTPS / secure context je povinný pre `DeviceOrientationEvent`. `file://` gyro nespustí.

Nepoužívajte nasadenie na aktívnu verejnú doménu. Koreňový `index.html` repozitára sa v tejto úlohe **nevytvára**.

## Budúci testovací cieľ

Po vizuálnom schválení môže byť tento prototyp skopírovaný do testovacieho umiestnenia:

```text
https://expresscard.eu/preview/
```

To nie je súčasť tejto úlohy. `/preview/` ostáva budúci izolačný cieľ, nie produkčný renderer.

## Štruktúra karty

Poradie vrstiev v `.ec-card`:

1. `.ec-card__bg-base` — základné globálne pozadie (krémový fallback + jemný gradient),
2. `.ec-card__bg-overlay` — prekryvné globálne pozadie s vlastnou opacity, pripravené na budúci obrázok (`background-size`, `background-position`, `cover`),
3. povrch konkrétnej sekcie (`.ec-region__surface`),
4. tvarovaný prechod strednej sekcie,
5. obsahové moduly (`.ec-region__content`),
6. `.ec-card__sheen` / `.ec-card__atmosphere` — odlesk a rezervovaná atmosphere vrstva,
7. pevný systémový podpis `expressCARD`.

Horný textový podpis a dolný SVG podpis **nie sú** obsahové sekcie ani bežné moduly.

### Tri obsahové sekcie

Priame deti `#ec-card` typu `section` sú presne tri. Výšku tvorí obsah; CSS nenastavuje pevnú ani percentuálnu výšku sekcie.

| Sekcia | Povrch | Moduly |
|--------|--------|--------|
| Horná | transparentný | fotografia, identita, primárne CTA, rýchle kontakty, sociálne kanály |
| Stredná | jemný krémový gradient, opacity iba na povrchu | predstavenie bez nadpisu, toggle Služby, toggle Kontakt |
| Dolná | jemný chladný povrch kompatibilný s kartou | nefunkčný náhľad „Vymeniť si kontakt“, záverečná poznámka |

Tvarovaný prechod je **jedna** CSS elipsa na hornom okraji strednej sekcie. Nie je používateľské SVG, nie je samostatne animovaný a sedí v odsadení medzi modulmi, nie cez text.

### Moduly

Existujúce prvky sú označené `data-ec-module` a `data-ec-kind`:

| `data-ec-kind` | Príklad |
|----------------|---------|
| `text` | identita, predstavenie, kontakt |
| `media` | profilová fotografia |
| `action` | Pridať do kontaktov |
| `icons` | rýchle kontakty, sociálne kanály |
| `repeatable` | služby |

HTML je pripravené na budúcu zmenu poradia, presun medzi povolenými sekciami a skrytie voliteľného modulu. Editor, drag-and-drop ani JSON konfigurácia **nie sú** implementované.

Prázdne produkčné placeholdery sa nezobrazujú. Telefón, e-mail, sociálne kanály a miesto fotografie sú **jasne označené ukážky**.

## Čo je funkčné a čo je maketa

| Prvok | Stav v prototýpe |
|-------|------------------|
| Tri obsahové sekcie a povrchy | vizuálne funkčné |
| Dve globálne pozadia + odlesk | vizuálne funkčné |
| Tvarovaný prechod | vizuálne funkčný, statický |
| Modulové označenie | štrukturálne pripravené, bez editora |
| Responzívny layout mobile / desktop | vizuálne funkčný |
| Systémový podpis `expressCARD` + SVG | vizuálne funkčný, bez gyro |
| Motion System s odstupňovanými rolami | funkčný v prehliadači, ak je dostupný JS a nie je zapnutý reduced-motion |
| Klávesové ovládanie a `:focus-visible` | funkčné |
| Odkaz na web `artefactum.sk` | reálny odkaz na verejný web |
| CTA **Pridať do kontaktov** | vizuálna maketa, VCF sa nestiahne |
| **Zavolať** / **E-mail** | vizuálne akcie s neaktívnymi demo hodnotami |
| **Vymeniť si kontakt** | iba označený nefunkčný náhľad, bez formulára |
| Sociálne kanály | kontrolovaný vizuálny komponent pod rýchlymi kontaktmi, bez reálnych profilov |
| Owner mode | samostatný statický prototyp `owner.html`, nie súčasť Guest karty |
| Editor, produkčný QR renderer, Wallet, PWA, analytika | mimo rozsahu |

Telefón `+421 000 000 000` a e-mail `kontakt@ukazka.invalid` sú **jasne označené ukážkové placeholdery**. JavaScript nezapisuje osobné údaje do `localStorage`, `sessionStorage` ani cookies a nevykonáva sieťové požiadavky.

## DEBUG režim

Diagnostický panel sa zobrazí **iba** s parametrom:

```text
?debug=1
```

Panel ukazuje:

- aktuálnu šírku viewportu,
- vyhodnotený režim mobile / desktop (podľa pointer/hover, nie podľa šírky okna),
- podporu hover / pointer,
- stav `prefers-reduced-motion`,
- aktívny tuning profil: `soft` | `balanced` | `expressive`,
- Media / Action / Icon / Background Motion: `aktívny` / `neaktívny`,
- aktívny motion profil: `mobile-gyro` | `mobile-fallback` | `desktop-pointer` | `reduced-motion` | `static`,
- dostupnosť `DeviceOrientationEvent`,
- dostupnosť `DeviceOrientationEvent.requestPermission`,
- permission stav: `not-required` | `prompt` | `granted` | `denied` | `error`,
- či prišli validné orientation eventy (`áno` / `nie`),
- diagnostický náklon (vyhladené a obmedzené vizuálne stupne, nie surové `beta`/`gamma`),
- dôvod fallbacku,
- informáciu, že sa JavaScript inicializoval.

Bez `?debug=1` panel nie je viditeľný. Nezobrazuje osobné údaje, surové hodnoty senzora, identifikátory zariadenia ani iné citlivé údaje. Nič z toho sa nezapisuje do storage a neodosiela sa cez sieť.

### Význam DEBUG hodnôt

| Pole | Čo znamená |
|------|-------------|
| Tuning | Prototypový profil `soft` / `balanced` / `expressive`. Nie je Solo / Team / Signature. |
| Media Motion | Fotografia používa tilt alebo fallback parallax. |
| Action Motion | Primárne CTA má jemný 1–2 px posun. |
| Icon Motion | Rýchle a sociálne ovládacie prvky majú jemný 1–2 px posun. |
| Background Motion | Globálna prekryvná vrstva má slabší posun ako fotografia. |
| DeviceOrientation | Prehliadač má konštruktor/API `DeviceOrientationEvent`. |
| requestPermission | Prehliadač vyžaduje explicitný súhlas (typicky iPhone/iPad Safari). |
| Permission `not-required` | Listener sa smie pripojiť bez dialógu (typicky Android Chrome). |
| Permission `prompt` | Čaká sa na kliknutie **Aktivovať pohyb**. |
| Permission `granted` / `denied` / `error` | Výsledok iOS permission API. |
| Orientation eventy `nie` | API existuje, ale ešte neprišli platné čísla `beta`/`gamma`. |
| Profil `static` | Bez JavaScriptu (panel sa v tomto stave nezobrazí). |
| Fallback `permission-required` | iOS čaká na gesto používateľa. |
| Fallback `waiting-orientation` | Listener je pripojený, čaká sa na prvé použiteľné dáta. |
| Fallback `no-events` | Listener bežal, ale použiteľné eventy neprišli. |
| Fallback `no-api` | `DeviceOrientationEvent` nie je dostupné. |
| Fallback `insecure-context` | Stránka nie je HTTPS / secure context. |
| Fallback `reduced-motion` | Motion je úplne potlačený. |

## Motion System — adaptívny prototyp

Motion sa aplikuje na konkrétne roly. **`.ec-card` sa nenakláňa.** Meno, pozícia, firma, claim, dlhé texty, nadpisy a systémové podpisy ostávajú statické.

Pohyb vzniká iba z reálneho náklonu zariadenia alebo z kurzora, nie z nepretržitej dekoratívnej slučky.

**HTTPS / secure context je povinný** pre `DeviceOrientationEvent`. Lokálne overujte cez `http://127.0.0.1` alebo `https://`.

### Motion roly

Všetky roly čítajú ten istý normalizovaný `pose` a zapisujú sa jedným koordinátorom.

| Rola | Prvok | Správanie |
|------|-------|-----------|
| media | `.ec-hero__stage` / fotografia | hlavný náklon, hĺbka a posun |
| action | `#ec-save-contact` | iba jemný posun približne 1–2 px, bez rotácie |
| icon | `.ec-quick__item`, `.ec-social__item` | jemný posun približne 1–2 px, bez samostatného listenera |
| background | `.ec-card__bg-overlay` | veľmi slabý parallax, slabší než fotografia |
| atmosphere | `.ec-card__sheen` | koordinovaný odlesk |
| static | meno, texty, podpisy, celá karta | bez gyro transformácie |

Sekundárne CTA **Napísať e-mail** ostáva statické. Ikonové popisy ostávajú čitateľné.

### Architektúra Motion Systemu (prototyp, nie produkčný kontrakt)

Súbor `expresscard-motion.js` je jeden koordinátor, nie sada nezávislých animácií.

| Vrstva | Zodpovednosť |
|--------|----------------|
| Vstup zariadenia | gyro (`beta`/`gamma`), pointer, scroll |
| Normalizovaný stav | `pose` (−1…1), sheen (0…1), parallax, intenzita |
| Koordinátor profilu | práve jeden profil, jedno `requestAnimationFrame` |
| Vizuálny výstup | CSS custom properties podľa roly |
| Globálne pravidlá | `prefers-reduced-motion`, visibility, odpojenie listenerov |

JavaScript **nerozoznáva** Solo / Team / Signature. Tuning `?motion=` je iba prototypová deklarácia. Produkčný tok ostáva: expressar Core Entitlement/Grant → validovaná publikačná konfigurácia → renderer.

### iPhone / iPad — tlačidlo „Aktivovať pohyb“

Safari na iOS/iPadOS vyžaduje `DeviceOrientationEvent.requestPermission()`. Prehliadač to smie spýtať **iba po gesto používateľa**.

Preto:

- permission dialóg sa **nespustí automaticky** pri načítaní,
- malé tlačidlo **Aktivovať pohyb** sa zobrazí len tam, kde je `requestPermission` skutočne potrebné,
- tlačidlo nie je hlavné CTA a nekonkuruje **Pridať do kontaktov**,
- po `granted` sa aktivuje `mobile-gyro` bez viditeľnej hlášky „Pohyb karty je aktívny.“; live region sa vyčistí,
- tlačidlo **Aktivovať pohyb** používa dodanú ikonu `assets/icons/sets/core-outline/motion.svg`,
- po `denied`, chybe alebo timeout-e ostane bezpečný mobilný fallback a príslušná chybová hláška,
- pri `prefers-reduced-motion` sa tlačidlo nezobrazí.

Na Androide (Chrome bez `requestPermission`) sa tlačidlo **nemá** zobrazovať. Listener sa pripojí a profil `mobile-gyro` sa zapne až po prvých platných číslach.

### Desktopový Guest mode (`desktop-pointer`)

- karta je bez kurzora stabilná a ako celok sa nenakláňa,
- kurzor veľmi slabo posunie odlesk, fotografiu, CTA a ikony,
- po odchode kurzora sa vrstvy vrátia,
- gyro listener sa na bežnom desktope nepripája,
- desktopový a mobilný profil nie sú aktívne naraz.

### Fallback poradie

1. `prefers-reduced-motion: reduce` → `reduced-motion` (žiadny senzor, žiadne tlačidlo, žiadny pointer tilt, všetky roly na nule).
2. Podporované a povolené gyro → `mobile-gyro`.
3. Gyro nepodporované, nedostupné, neprišli eventy alebo bolo odmietnuté → `mobile-fallback` (jemný scroll posun fotografickej a background vrstvy).
4. Desktop s `hover` + `pointer: fine` → `desktop-pointer`.
5. Bez JavaScriptu → plnohodnotný statický dizajn (`static`).

### Reduced motion

Pri `prefers-reduced-motion: reduce`:

- tlačidlo **Aktivovať pohyb** sa nezobrazí,
- permission sa nežiada,
- gyro listener sa nepripája,
- media, action, icon, background, sheen aj vstupná animácia sú vypnuté,
- statická karta ostáva čitateľná.

Zmena preferencie počas otvorenej stránky sa spracuje bez zanechania druhého aktívneho profilu.

## Testovacie URL

Po nasadení do `/preview/` (alebo lokálneho servera) použite:

```text
index.html?motion=soft
index.html?motion=balanced
index.html?motion=expressive
index.html?motion=balanced&debug=1
```

Reduced-motion sa overuje systémovým nastavením OS / prehliadača, nie query parametrom. Pri zapnutom `prefers-reduced-motion` ostáva karta statická pri každom tuning profile.

## Konzolové testy

Identifikátory `#ec-card`, `#ec-name`, `#ec-save-contact` a `.ec-quick__item` ostávajú v platnosti.

TEST 1 — tri hlavné sekcie:

```javascript
document.querySelectorAll('#ec-card > section').length
```

Očakávanie: `3`

TEST 2 — systémová značka:

```javascript
({
  correct: document.body.innerText.includes('expressCARD'),
  wrong: document.body.innerText.includes('EXPRESSCARD')
})
```

Očakávanie: `correct: true`, `wrong: false`

TEST 3 — karta a text ostávajú statické:

```javascript
({
  card: getComputedStyle(document.querySelector('#ec-card')).transform,
  name: getComputedStyle(document.querySelector('#ec-name')).transform
})
```

Očakávanie: obe hodnoty sú `none` alebo ekvivalent statického stavu.

TEST 4 — CTA a ikony pri aktívnom Motion:

Po aktivovaní pohybu a pri naklonenom telefóne alebo aktívnom desktop pointer profile:

```javascript
({
  cta: getComputedStyle(document.querySelector('#ec-save-contact')).transform,
  icons: [...document.querySelectorAll('.ec-quick__item')]
    .map(node => getComputedStyle(node).transform)
})
```

Očakávanie: CTA a ikony majú jemnú aktívnu transformáciu; karta a meno ostávajú statické.

TEST 5 — bez inline CSS/JS v HTML zdroji:

```javascript
({
  inlineStyles: document.querySelectorAll('style, [style]').length,
  inlineScripts: document.querySelectorAll('script:not([src])').length
})
```

Očakávanie po načítaní HTML: `inlineStyles: 0`, `inlineScripts: 0`.

Motion tokeny sa zapisujú do existujúceho `:root` CSS pravidla, nie do atribútu `style` na karte. Ak prehliadač neumožní prístup k stylesheetu, koordinátor použije fallback na `document.documentElement` a TEST 5 môže po spustení JS ukázať `style` na `<html>`.

## Príznaky zlyhania

- Telefón sa nakláňa, ale karta nereaguje → chýba permission, API nie je podporované, stránka nie je HTTPS, alebo neprišli orientation eventy. Overiť v `?debug=1`.
- Tlačidlo aktivácie sa zobrazuje opakovane alebo na Androide bez potreby → chybná detekcia permission režimu.
- Gyro funguje, ale scroll je blokovaný → **kritická ergonomická chyba**.
- Pohyb trhá → chýba vyhladenie alebo je priveľa DOM zápisov.
- Pohyb je aktívny pri reduced-motion → **kritická chyba**.
- Desktop pointer a gyro pôsobia naraz → chyba výberu profilu.
- Celá karta alebo meno sa nakláňa → **kritická chyba** Motion rolí.
- CTA alebo ikony rotujú / utekajú pred dotykom → príliš silný action/icon token.
- Tvarovaný prechod prekrýva text → zlyhanie odsadenia sekcie.
- Ak nie sú aplikované štýly, problém je cesta k CSS (`assets/css/expresscard-prototype.css?v=20260829-motion-icon1`).
- Ak karta funguje, ale Motion vôbec nenaštartuje, skontrolovať JS (`assets/js/expresscard-motion.js?v=20260829-motion-icon1`).

## Owner mode prototyp

`owner.html` je **statický, mobilne orientovaný Owner mode**. Nie je druhá karta, editor, CRM ani produkčný prístup vlastníka.

Owner mode preberá identitu vybranej ukážkovej karty a jej verejný Guest odkaz. Predvolená karta je **AF – Artefactum** (`https://expresscard.eu/alexander-smart`). QR, **Zdieľať** a **Kopírovať** vždy používajú verejný Guest odkaz aktívnej karty. Owner credential, token, prihlásenie, cookies ani úložisko prehliadača **nie sú** implementované.

Owner CSS je namespacované cez `.ec-owner` v tom istom súbore `expresscard-prototype.css`. Nový CSS súbor nevznikol. `expresscard-motion.js` sa v Owner mode **nenačítava**.

### Informačná architektúra

1. Centrovaná hlavička **Moja expressCARD**.
2. Prepínač **Moje karty** — centrovaná skupina troch dlaždíc (AS, AF, EX) s firemnými tokenmi.
3. Centrovaná identita — fotografia/monogram, meno, pozícia, firma.
4. QR placeholder a informatívna verejná URL.
5. Jeden riadok troch kruhových akcií — **Verejná karta**, **Zdieľať**, **Kopírovať**.
6. Podmienená akcia **Získané kontakty (n)** — firemné centrované CTA, prototypový modal.
7. **Správa expressCARD** — sekundárny prototypový odkaz na úvodnú stránku expressar.eu.
8. Povinný systémový podpis `/images/expressCARD_App.svg` v päte (nie odkaz, bez Motion).

Normálny stav „Publikovaná“ sa nezobrazuje. Kontextové QR, analytika, follow-up, VCF a plná správa kontaktov **nie sú** na obrazovke.

### Prepínač kariet

Tri prototypové karty sú izolované dáta v `expresscard-owner.js`, nie produkčný JSON kontrakt. Prepnutie atomicky aktualizuje dlaždicu, identitu, Guest URL, QR popis, počet neprečítaných kontaktov a viditeľnosť náhľadov. Vybraná karta ostáva v korporátnom gradiente s iniciálami. Nevybraná karta zobrazí `thumbnail`, ak existuje; inak dočasný odstrániteľný monogram (`data-temporary-fallback="monogram"`). V aktuálnom prototýpe žiadny náhľadový rastrový súbor ku kartám nie je dodaný.

### Share, Clipboard a fallbacky

- `navigator.share` zdieľa iba verejný Guest odkaz aktívnej karty. Ak API chýba, použije sa kopírovanie.
- Clipboard API skopíruje ten istý verejný odkaz. Ak zlyhá alebo chýba, zobrazí sa pole na ručné označenie.
- Zrušenie systémového zdieľania (`AbortError`) nesmie ticho spustiť kopírovanie ako chybu.
- Bez JavaScriptu ostávajú identita predvolenej karty, QR priestor, verejný odkaz a otvorenie Guest karty čitateľné.

### Owner DEBUG

```text
owner.html?debug=1
```

Panel ukazuje viewport, režim `owner`, aktívnu kartu, Guest odkaz, neprečítané kontakty, stav modalu, Share/Clipboard, ikonový set, chýbajúce SVG, poslednú akciu, `motion script: nenačítaný` a `storage: nepoužitý`. Bez `?debug=1` panel nie je viditeľný.

### Owner konzolové testy

TEST 1 — centrovanie `.ec-owner` (ľavý a pravý voľný priestor na desktope takmer zhodný).

TEST 2 — hlavička „Moja expressCARD“, bez Zavrieť, bez „Karta je publikovaná.“, bez „Otvoriť Guest mode“.

TEST 3 — tri položky `[data-owner-card-switch]`, predvolene `AF` s `aria-current="true"`, `border-radius: 0 9px 0 9px`.

TEST 4 — klik na `AS` atomicky vymení Guest URL aj počet kontaktov.

TEST 5 — akcie `share`, `copy-link`, `open-public`, `manage-card` s predpísanými SVG cestami a výškou ≥ 48 px.

TEST 6 — nové kontakty a prístupný `dialog`; po zatvorení akcia zmizne.

TEST 7 — odstránené sekcie „Ďalšie akcie“, „Stav a kontakty“, VCF a náhľad.

TEST 8 — bez Motion skriptu, bez inline CSS/JS, bez owner secret atribútov, bez storage.

### Owner manuálny checklist

- [ ] Owner obal je na desktope v strede viewportu rovnako ako Guest karta.
- [ ] Hlavička je iba **Moja expressCARD**; tlačidlo Zavrieť neexistuje.
- [ ] Prepínač troch kariet posúva údaje atomicky; EX skryje kontakty (0).
- [ ] Guest mode sa otvára iba cez kruhovú akciu **Verejná karta**.
- [ ] Tri kruhové akcie sú centrované a neprekrývajú sa na 320 px.
- [ ] **Správa expressCARD** otvára `https://expressar.eu/`.
- [ ] Modal kontaktov sa zatvára Escape, pozadím aj tlačidlom **Zavrieť zoznam**.
- [ ] Bez `?debug=1` diagnostický panel nie je viditeľný.
- [ ] Guest `index.html` ostáva otvoriteľný a Motion sa tam načítava.

Budúce rozšírenia (nie v tomto prototype): kontextové QR, pomenovaný kontext zdieľania, analytika, follow-up, plná správa kontaktov v klientskom UI, produkčný QR renderer, VCF, owner credential.

## Manuálny checklist

### Mobile layout

- [ ] Identita, claim a CTA **Pridať do kontaktov** sú pochopiteľné bez zbytočného scrollovania.
- [ ] Dotykové plochy sú približne 44 × 44 px alebo väčšie.
- [ ] Horná / stredná / dolná sekcia sa predĺži pri dlhšom texte.
- [ ] Tvarovaný prechod neprekrýva CTA, ikony ani text.
- [ ] Obsah pokračuje prirodzeným vertikálnym scrollom.
- [ ] Motion neblokuje scroll ani ovládanie.
- [ ] CTA a ikony iba jemne plávajú; karta a text stoja.
- [ ] Horný podpis je `expressCARD`, bližšie k okraju a menej výrazný než meno.
- [ ] Dolný SVG podpis je statický a kontrastný voči svetlémú pozadiu.

Reálny gyroskop **nie je možné overiť emuláciou** v desktopovom prehliadači. Fyzický test ostáva:

**NA OVERENIE POUŽÍVATEĽOM NA FYZICKOM ZARIADENÍ**

### Android Chrome (fyzický telefón)

- [ ] Stránka beží cez HTTPS alebo `http://127.0.0.1`.
- [ ] Tlačidlo **Aktivovať pohyb** sa **nezobrazuje**.
- [ ] Po náklone telefónu sa pohne fotografia; CTA a ikony sa posunú iba 1–2 px.
- [ ] Vertikálny scroll ostáva plynulý.
- [ ] V `?debug=1`: profil `mobile-gyro`, Permission `not-required`, Orientation eventy `áno`, Media/Action/Icon Motion `aktívny`.

### iPhone Safari (fyzický telefón)

- [ ] Pri načítaní sa **nezobrazí** systémový permission dialóg.
- [ ] Je viditeľné malé tlačidlo **Aktivovať pohyb**.
- [ ] Po kliknutí a `Allow` karta reaguje na náklon podľa rolí.
- [ ] Po `Don't Allow` ostane karta použiteľná, tlačidlo sa znova nevnucuje.
- [ ] Scroll nie je blokovaný.
- [ ] V `?debug=1`: pred kliknutím Permission `prompt`; po súhlase `granted` a profil `mobile-gyro`.

### Desktop

- [ ] Karta nie je rozťahovaná cez celú šírku.
- [ ] V pokoji je karta stabilná a ako celok sa nenakláňa.
- [ ] Pohyb pri kurzore je jemný; po odchode kurzora sa vráti.
- [ ] Sekcie a tvarovaný prechod ostávajú vizuálne spojené ako jedna karta.
- [ ] Tlačidlo **Aktivovať pohyb** sa nezobrazuje.
- [ ] V `?debug=1` je profil `desktop-pointer`. Úzke okno nestačí na zapnutie gyra.

### Reduced motion

- [ ] Vypnúť v OS / prehliadači `prefers-reduced-motion`.
- [ ] Vstupná animácia, náklon, parallax, gyro, CTA/icon posun aj pohyb odlesku sú vypnuté.
- [ ] Tlačidlo **Aktivovať pohyb** sa nezobrazí.
- [ ] Statický dizajn ostáva kompletný a čitateľný.
- [ ] V `?debug=1` je profil `reduced-motion` a všetky Motion roly `neaktívny`.

### Bez JavaScriptu

- [ ] Vypnúť JS v prehliadači.
- [ ] Karta ostáva čitateľná, sémantická a použiteľná.
- [ ] Webový odkaz na `artefactum.sk` funguje.
- [ ] DEBUG panel sa nezobrazí.
- [ ] Žiadny obsah nie je závislý od animácie.

## Zákaz nasadenia

Tento prototyp **nesmie** byť v tejto fáze:

- nasadený do koreňa aktívnej domény,
- označený ako produkčný renderer alebo šablóna,
- prepojený s WordPressom, expressar Core, PHP, databázou, API alebo pluginom `_expressar-card`.

## Budúce podklady

Pred ďalšou vizuálnou iteráciou budú potrebné:

- fotografia držiteľa,
- logo Artefactum / finálny brand podpis (ak bude schválený),
- finálne kontaktné údaje,
- finálne ikony sociálnych a komunikačných kanálov.

Ďalšia fáza (editor, JSON kontrakt, produkčný renderer) sa týmto prototypom nespúšťa.
