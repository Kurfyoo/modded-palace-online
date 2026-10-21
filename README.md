# MODDED PALACE ONLINE
## Desc
Play as your favorite characters in a modified version of the hit playing card game palace!
## Credits
- Brendan Mitchell
- Zayd Chafik
## Editor Notes
- Website is currently static
    - Servers, databases, and online features yet to be implemented
- The browser game is implemented in JavaScript and runs without Python or Pyodide.
- To play locally, serve `modded-palace-website/` as static files and open `index.html` in a browser.
- Run the engine checks with `node --test modded-palace-website/game-engine.test.js`.
- Add custom characters in the setup screen's Character Creator Studio or import a JSON pack. Start from [character-import-template.json](./modded-palace-website/character-import-template.json); packs use `formatVersion: 1` and a `characters` array. Each character has a `name` and 1-10 `abilities`; each ability has a `name` and may include `description`, `relatedRules`, and an `evolution` object with the same fields. Custom characters are selectable in games, and their sheets are available from each player's Character sheet button. These descriptions are references for players; ability effects are not automated by the game. Custom characters are saved in that browser and can be exported from setup. Existing characters cannot be overwritten; importing a custom character with the same name updates that custom entry.
