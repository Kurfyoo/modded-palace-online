"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createBridge() {
	const window = {};
	vm.runInNewContext(fs.readFileSync(new URL("./game-engine.js", `file://${__filename}`), "utf8"), { window });
	return window.PalaceBridge;
}

function settings(players, decks = 1, jokers = 2) {
	return JSON.stringify({ players, decks, jokers });
}

function finishSetup(bridge, state) {
	while (state.phase === "setup") {
		state = JSON.parse(bridge.act(JSON.stringify({ type: "setup", cards: [0, 1, 2] })));
	}
	return state;
}

test("catalog keeps gameplay metadata without embedding page descriptions", () => {
	const bridge = createBridge();
	const catalog = JSON.parse(bridge.get_catalog());
	assert.deepEqual(catalog.characters.map((character) => character.name), ["Sukuna", "Gojo"]);
	assert.ok(catalog.characters.every((character) => character.tracks.every((track) =>
		typeof track.ability === "string" && Array.isArray(track.rules)
		&& (!track.evolution || typeof track.evolution.ability === "string" && Array.isArray(track.evolution.rules))
		&& !Object.hasOwn(track, "description")
		&& !Object.hasOwn(track.evolution || {}, "description"))));
	assert.equal(catalog.defaults.players, 6);
	assert.equal(Object.hasOwn(catalog, "rules"), false);
	assert.equal(Object.hasOwn(catalog, "domain_rule"), false);
	const indexHtml = fs.readFileSync(new URL("./index.html", `file://${__filename}`), "utf8");
	const charactersHtml = fs.readFileSync(new URL("./characters.html", `file://${__filename}`), "utf8");
	const rulesHtml = fs.readFileSync(new URL("./rules.html", `file://${__filename}`), "utf8");
	assert.match(indexHtml, /id="character-details"/);
	assert.match(indexHtml, /id="character-creator"/);
	assert.match(indexHtml, /id="show-character-sheet"/);
	assert.deepEqual([...charactersHtml.matchAll(/data-character="([^"]+)"/g)].map((match) => match[1]), ["Sukuna", "Gojo"]);
	assert.match(charactersHtml, /Spider Net Cleave/);
	assert.match(rulesHtml, /Domain Clashing/);
	assert.doesNotMatch(charactersHtml + rulesHtml, /<script\b/i);
});

test("imported characters are selectable and their abilities remain reference-only", () => {
	const bridge = createBridge();
	const pack = {
		formatVersion: 1,
		characters: [{
			name: "Catalog-only character",
			abilities: [{
				name: "Simple Domain",
				description: "A description that must not activate the built-in ability.",
				relatedRules: ["A rule reference"],
				evolution: { name: "Mastered Six Eyes", description: "An informational evolution.", relatedRules: [] },
			}],
		}],
	};
	const result = JSON.parse(bridge.import_characters(JSON.stringify(pack)));
	assert.equal(result.imported, 1);
	const character = result.characters.find((entry) => entry.name === "Catalog-only character");
	assert.equal(character.imported, true);
	assert.equal(character.tracks[0].description, pack.characters[0].abilities[0].description);
	assert.deepEqual(character.tracks[0].relatedRules, ["A rule reference"]);

	const exported = JSON.parse(bridge.export_characters());
	assert.deepEqual(exported.characters, pack.characters);
	let game = JSON.parse(bridge.new_game(settings([
		{ type: "Human", character: "Catalog-only character" },
		{ type: "Bot", character: "Gojo" },
	])));
	assert.equal(game.phase, "setup");
	assert.equal(bridge.game.effective(0, "Simple Domain"), null);
	assert.equal(bridge.evolvable(0).length, 0);
	game = finishSetup(bridge, game);
	assert.equal(game.phase, "play");
	assert.equal(game.players[0].character, "Catalog-only character");
});

test("character pack validation is atomic and protects built-in characters", () => {
	const bridge = createBridge();
	const result = JSON.parse(bridge.import_characters(JSON.stringify({
		formatVersion: 1,
		characters: [
			{ name: "Should not be partially imported", abilities: [{ name: "Ability" }] },
			{ name: "Sukuna", abilities: [{ name: "Replacement" }] },
		],
	})));
	assert.match(result.error, /built in and cannot be replaced/);
	assert.deepEqual(JSON.parse(bridge.get_catalog()).characters.map((character) => character.name), ["Sukuna", "Gojo"]);
	assert.match(JSON.parse(bridge.import_characters(JSON.stringify({ formatVersion: 2, characters: [] }))).error, /formatVersion 1/);
});

test("new games validate player, deck, and human-player requirements", () => {
	const bridge = createBridge();
	assert.match(JSON.parse(bridge.new_game(settings([{ type: "Human", character: "Sukuna" }]))).error, /Players must be between/);
	assert.match(JSON.parse(bridge.new_game(settings([
		{ type: "Bot", character: "Gojo" },
		{ type: "Bot", character: "Sukuna" },
	]))).error, /At least one player must be a human/);
	const tooManyPlayers = [{ type: "Human", character: "Gojo" }, ...Array.from({ length: 11 }, () => ({ type: "Bot", character: "Sukuna" }))];
	assert.match(JSON.parse(bridge.new_game(settings(tooManyPlayers, 1, 0))).error, /need at least/);
});

test("hot-seat setup hands control to each human and starts play", () => {
	const bridge = createBridge();
	let state = JSON.parse(bridge.new_game(settings([
		{ type: "Human", character: "Sukuna" },
		{ type: "Human", character: "Gojo" },
	])));
	assert.equal(state.phase, "setup");
	assert.equal(state.viewer, 0);
	state = JSON.parse(bridge.act(JSON.stringify({ type: "setup", cards: [0, 1, 2] })));
	assert.equal(state.phase, "setup");
	assert.equal(state.viewer, 1);
	assert.equal(state.me.name, "Player 2");
	state = JSON.parse(bridge.act(JSON.stringify({ type: "setup", cards: [0, 1, 2] })));
	assert.equal(state.phase, "play");
	assert.equal(state.hot_seat, true);
	assert.equal(state.viewer, 0);
});

test("Joker prompts preserve the game until the selected value is submitted", () => {
	const bridge = createBridge();
	let state = JSON.parse(bridge.new_game(settings([
		{ type: "Human", character: "Sukuna" },
		{ type: "Bot", character: "Gojo" },
	])));
	state = finishSetup(bridge, state);
	const game = bridge.game;
	game.players[0].hand = [{ rank: "Joker", suit: "", deck_number: 3 }];
	game.discards[0] = [];
	game.pile_values[0] = 14;
	const prompt = JSON.parse(bridge.act(JSON.stringify({ type: "play", card: 0, pile: 0 })));
	assert.equal(prompt.ask.title, "Joker value");
	assert.equal(game.cards_played, 0);
	state = JSON.parse(bridge.act(JSON.stringify({ type: "play", card: 0, pile: 0, answers: [12] })));
	assert.equal(game.cards_played, 1);
	assert.equal(game.discards[0][0].rank, "Joker");
	assert.equal(state.phase, "play");
});

test("an illegal opening play picks up both discard piles and ends the turn", () => {
	const bridge = createBridge();
	let state = JSON.parse(bridge.new_game(settings([
		{ type: "Human", character: "Sukuna" },
		{ type: "Bot", character: "Gojo" },
	])));
	state = finishSetup(bridge, state);
	const game = bridge.game;
	game.players[0].hand = [{ rank: "3", suit: "Clubs", deck_number: 0 }];
	game.discards[0] = [{ rank: "Ace", suit: "Spades", deck_number: 0 }];
	game.discards[1] = [{ rank: "King", suit: "Hearts", deck_number: 0 }];
	game.pile_values = [14, 13];
	game.current = 0;
	bridge.act(JSON.stringify({ type: "play", card: 0, pile: 0 }));
	assert.equal(game.current, 1);
	assert.equal(game.discards[0].length + game.discards[1].length, 0);
	assert.ok(game.players[0].hand.some((card) => card.rank === "Ace"));
	assert.ok(game.players[0].hand.some((card) => card.rank === "King"));
});

test("World Cutting Slash prompts before deleting a card and applying Cut Meter", () => {
	const bridge = createBridge();
	let state = JSON.parse(bridge.new_game(settings([
		{ type: "Human", character: "Sukuna" },
		{ type: "Bot", character: "Gojo" },
	])));
	state = finishSetup(bridge, state);
	const game = bridge.game;
	game.players[0].pending_world_slashes = 1;
	const prompt = JSON.parse(bridge.act(JSON.stringify({ type: "resolve_slash" })));
	assert.match(prompt.ask.title, /choose a card or pile to delete/);
	assert.equal(game.deleted.length, 0);
	bridge.act(JSON.stringify({ type: "resolve_slash", answers: [0, 0, 0] }));
	assert.equal(game.deleted.length, 1);
	assert.equal(game.players[1].cut_meter, 1);
	assert.equal(game.players[0].pending_world_slashes, 0);
});

test("Simple Domain activates once and can discard a card to cleanse Cut Meter", () => {
	const bridge = createBridge();
	let state = JSON.parse(bridge.new_game(settings([
		{ type: "Human", character: "Gojo" },
		{ type: "Bot", character: "Gojo" },
	])));
	state = finishSetup(bridge, state);
	const player = bridge.game.players[0];
	bridge.act(JSON.stringify({ type: "simple_domain" }));
	assert.equal(player.simple_domain_active, true);
	assert.equal(player.simple_domain_used, true);
	player.cut_meter = 2;
	player.hand = [{ rank: "2", suit: "Clubs", deck_number: 0 }];
	bridge.act(JSON.stringify({ type: "simple_domain", answers: [0, 0] }));
	assert.equal(player.cut_meter, 1);
	assert.equal(player.hand.length, 3);
	assert.ok(bridge.game.destroyed.some((card) => card.rank === "2"));
});

test("Binding Vow can select a face-up card once draw piles are empty", () => {
	const bridge = createBridge();
	let state = JSON.parse(bridge.new_game(settings([
		{ type: "Human", character: "Sukuna" },
		{ type: "Bot", character: "Gojo" },
	])));
	state = finishSetup(bridge, state);
	const game = bridge.game, player = game.players[0];
	const card = { rank: "7", suit: "Hearts", deck_number: 0 };
	player.hand = [];
	player.face_up = [card];
	game.draw_piles = [[], []];
	game.current = 0;
	const prompt = JSON.parse(bridge.act(JSON.stringify({ type: "vow" })));
	assert.match(prompt.ask.title, /Choose a card/);
	bridge.act(JSON.stringify({ type: "vow", answers: [0] }));
	assert.equal(player.vow_card, card);
	assert.equal(game.current, 1);
	assert.equal(game.source(0)[0], "face_up");
	assert.equal(game.source(0)[1][0], card);
});

test("admin editing stays session-gated and updates card values", () => {
	const bridge = createBridge();
	bridge.new_game(settings([
		{ type: "Human", character: "Sukuna" },
		{ type: "Bot", character: "Gojo" },
	]));
	assert.match(JSON.parse(bridge.admin_cards()).error, /locked/);
	assert.equal(JSON.parse(bridge.admin_unlock("incorrect")).unlocked, false);
	assert.equal(JSON.parse(bridge.admin_unlock("ZaydIsABum")).unlocked, true);
	const rows = JSON.parse(bridge.admin_cards()).rows;
	assert.ok(rows.length > 0);
	assert.match(JSON.parse(bridge.admin_set(0, "Ace", "Spades")).message, /Ace of Spades/);
});

test("Reversal Red can swap its 6 or 9 with a visible opposing card", () => {
	const bridge = createBridge();
	let state = JSON.parse(bridge.new_game(settings([
		{ type: "Human", character: "Gojo" },
		{ type: "Bot", character: "Gojo" },
	])));
	state = finishSetup(bridge, state);
	const game = bridge.game, player = game.players[0], opponent = game.players[1];
	player.ability_states["Lapse Blue"].evolved = true;
	player.hand = [{ rank: "6", suit: "Clubs", deck_number: 0 }];
	opponent.face_up = [{ rank: "9", suit: "Spades", deck_number: 0 }];
	const prompt = JSON.parse(bridge.act(JSON.stringify({ type: "card_swap" })));
	assert.match(prompt.ask.title, /Choose a card to swap/);
	bridge.act(JSON.stringify({ type: "card_swap", answers: [0, 0] }));
	assert.ok(player.hand.some((card) => card.rank === "9"));
	assert.equal(opponent.face_up[0].rank, "6");
	assert.equal(player.swap_round, game.round);
});

test("bots progress through the same bridge and expose a valid game state", () => {
	const bridge = createBridge();
	let state = JSON.parse(bridge.new_game(settings([
		{ type: "Human", character: "Sukuna" },
		{ type: "Bot", character: "Gojo" },
	])));
	state = finishSetup(bridge, state);
	const game = bridge.game;
	game.current = 1;
	game.draw_piles = [[], []];
	game.players[1].hand = [{ rank: "3", suit: "Clubs", deck_number: 0 }];
	game.players[1].face_up = [];
	game.players[1].face_down = [];
	game.discards[0] = [{ rank: "2", suit: "Hearts", deck_number: 0 }];
	game.pile_values[0] = 2;
	state = JSON.parse(bridge.bot_step(1));
	assert.ok(["play", "over"].includes(state.phase));
	assert.ok(game.log.some((line) => line.includes("Bot 1 played")));
});

test("the HTML loads only the local JavaScript engine before the UI", () => {
	const html = fs.readFileSync(new URL("./index.html", `file://${__filename}`), "utf8");
	assert.doesNotMatch(html, /pyodide|PALACE_FILES|palacegames\.py|web_bridge\.py/i);
	assert.ok(html.indexOf('src="game-engine.js"') < html.indexOf('src="script.js"'));
});
