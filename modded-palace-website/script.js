"use strict";

const SUIT_SYMBOLS = {Clubs: "♣", Diamonds: "♦", Hearts: "♥", Spades: "♠" };
const RANK_SHORT = { Jack: "J", Queen: "Q", King: "K", Ace: "A" };

let bridge = null;
let catalog = null;
let selectedCharacter = null;
let state = null;
let selCard = null;
let selPile = null;
let setupSel = new Set();
let confirmedViewer = null;
let fastForward = false;
let botTimer = null;
let busy = false;
let adminOpen = false;
let playerRows = [];

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(props)) {
		if (key === "class") node.className = value;
		else if (key === "onclick") node.addEventListener("click", value);
		else if (value !== undefined && value !== null) node[key] = value;
	}
	for (const child of children.flat()) {
		node.append(child instanceof Node ? child : document.createTextNode(child));
	}
	return node;
}

// ---------------------------------------------------------------- boot

function boot() {
	bridge = window.PalaceBridge;
	if (!bridge) throw new Error("The game engine could not be loaded.");
	catalog = JSON.parse(bridge.get_catalog());
	selectedCharacter = catalog.characters[0].name;
	$("loading").hidden = true;
	buildSetup();
	$("setup").hidden = false;
	if (location.hash === "#rules") openRules();
}

try {
	boot();
} catch (error) {
	$("loading-text").textContent = "Could not start: " + error.message;
}

// ---------------------------------------------------------------- setup screen

function showRule(name) {
	showDialog(name, el("p", {}, catalog.rules[name]), [{ label: "Close" }]);
}

// Turns known multi use rule names inside a description into clickable underlined links.
function withRules(text, rules) {
	const container = el("span");
	let pieces = [text];
	for (const rule of rules) {
		pieces = pieces.flatMap((piece) => {
			if (typeof piece !== "string") return [piece];
			const out = [];
			const lower = piece.toLowerCase();
			const needle = rule.toLowerCase();
			let position = 0;
			let found = lower.indexOf(needle, position);
			while (found !== -1) {
				out.push(piece.slice(position, found));
				out.push(el("span", { class: "rule", onclick: () => showRule(rule) }, piece.slice(found, found + rule.length)));
				position = found + rule.length;
				found = lower.indexOf(needle, position);
			}
			out.push(piece.slice(position));
			return out;
		});
	}
	container.append(...pieces.map((piece) => (typeof piece === "string" ? document.createTextNode(piece) : piece)));
	return container;
}

function renderCharacterDetails() {
	const character = catalog.characters.find((entry) => entry.name === selectedCharacter);
	const box = $("character-details");
	box.replaceChildren(el("h3", {}, character.name));
	for (const track of character.tracks) {
		const block = el("div", { class: "track" },
			el("strong", {}, track.ability), el("br"),
			withRules(track.description, track.rules));
		if (track.evolution) {
			block.append(el("br"), el("strong", {}, "Evolution: " + track.evolution.ability), el("br"),
				withRules(track.evolution.description, track.evolution.rules));
		}
		box.append(block);
	}
	box.append(el("p", { class: "hint" }, "Each evolution needs a Joker in hand before you play any cards and ends your turn. Underlined rule names can be clicked to read what they do."));
}

function buildSetup() {
	const list = $("character-list");
	list.replaceChildren(...catalog.characters.map((character) =>
		el("button", {
			class: character.name === selectedCharacter ? "selected" : "",
			onclick: () => {
				selectedCharacter = character.name;
				buildSetup();
			},
		}, character.name)));
	renderCharacterDetails();
	rebuildPlayerRows();
}

function rebuildPlayerRows() {
	const count = Math.max(2, Math.min(catalog.max_players, parseInt($("player-count").value, 10) || 2));
	while (playerRows.length < count) {
		playerRows.push({ type: playerRows.length === 0 ? "Human" : "Bot", character: catalog.random });
	}
	playerRows.length = count;
	const rows = $("player-rows");
	rows.replaceChildren();
	playerRows.forEach((row, index) => {
		const type = el("select", { onchange: (event) => { row.type = event.target.value; } },
			...["Human", "Bot"].map((value) => el("option", { value, selected: value === row.type }, value)));
		const line = el("div", { class: "row-player" }, el("span", {}, `Player ${index + 1}`), type);
		if (index === 0) {
			line.append(el("span", {}, selectedCharacter));
		} else {
			const choices = [catalog.random, ...catalog.characters.map((c) => c.name)];
			line.append(el("select", { onchange: (event) => { row.character = event.target.value; } },
				...choices.map((value) => el("option", { value, selected: value === row.character }, value))));
		}
		rows.append(line);
	});
}

$("player-count").addEventListener("change", rebuildPlayerRows);
$("restore-defaults").addEventListener("click", () => {
	$("player-count").value = catalog.defaults.players;
	$("deck-count").value = catalog.defaults.decks;
	$("joker-count").value = catalog.defaults.jokers;
	playerRows = [];
	rebuildPlayerRows();
});

$("start").addEventListener("click", () => {
	$("setup-error").textContent = "";
	const rows = playerRows.map((row, index) => ({
		type: row.type,
		character: index === 0 ? selectedCharacter : row.character,
	}));
	const result = JSON.parse(bridge.new_game(JSON.stringify({
		players: rows,
		decks: parseInt($("deck-count").value, 10),
		jokers: parseInt($("joker-count").value, 10),
	})));
	if (result.error) {
		$("setup-error").textContent = result.error;
		return;
	}
	$("setup").hidden = true;
	$("game").hidden = false;
	confirmedViewer = null;
	fastForward = false;
	selCard = selPile = null;
	setupSel = new Set();
	applyState(result);
});

$("new-game").addEventListener("click", () => {
	if (!confirm("Abandon this game and return to setup?")) return;
	clearTimeout(botTimer);
	botTimer = null;
	state = null;
	$("game").hidden = true;
	$("setup").hidden = false;
});

// ---------------------------------------------------------------- dialogs

function showDialog(title, body, buttons) {
	$("modal-title").textContent = title;
	const bodyBox = $("modal-body");
	bodyBox.replaceChildren(body);
	const buttonBox = $("modal-buttons");
	delete buttonBox.dataset.handoff;
	buttonBox.replaceChildren(...buttons.map((button) =>
		el("button", {
			onclick: () => {
				closeDialog();
				if (button.action) button.action();
			},
		}, button.label)));
	$("modal").hidden = false;
}

function closeDialog() {
	$("modal").hidden = true;
}

function showAsk(ask, answers, action) {
	const buttons = ask.options.map((label, index) => ({
		label,
		action: () => send(action, [...answers, index]),
	}));
	buttons.push({ label: "Cancel" });
	showDialog(ask.title, el("p", {}), buttons);
}

$("show-log").addEventListener("click", () => {
	if (state) showDialog("Action log", el("pre", {}, state.log.join("\n")), [{ label: "Close" }]);
});

// ---------------------------------------------------------------- rules page

const RULES_SECTIONS = [
	["Goal", [
		"Get rid of all of your cards before everyone else. Cards are played from your hand first, then your face-up cards, then your face-down cards. Players who run out finish in order; the last player left is last place.",
	]],
	["Setup", [
		"Every player is dealt 3 face-down cards and 6 cards in hand, then keeps 3 of the 6 face-up on the table. The rest of the deck is split into two draw piles. One card from each draw pile starts the two discard piles (a Joker is reshuffled back; a 10 destroys its pile right away).",
		"You choose the number of players (human or bot), the number of 52-card decks and the number of Jokers before the game starts.",
	]],
	["Taking a turn", [
		"There are two discard piles. On your turn you choose one of them and play at least one card on it. Any extra cards you play in the same turn must go on that same pile. Press End turn when you are done.",
		"Your hand is topped up to 3 cards after each play while the draw piles last. Face-Up cards can only be played once your hand and both draw piles are empty, and face-down cards after that (you play them blind).",
		"The first card you play must be equal to or higher than the top card of the pile (Jack 11, Queen 12, King 13, Ace 14). An empty pile accepts anything.",
		"After your first card, you can keep stacking on the pile you just played on, as long as each card is the same value as the top card or exactly one higher.",
	]],
	["Special cards", [
		"2: can be played on anything as your first card, and later only on top of an Ace or another 2.",
		"10: as the first card of your turn it can be played on anything. Any 10 destroys the whole pile it is played on, moving it to the destroyed pile.",
		"Joker: wild. You choose its value from 2 to 14 when you play it. A Joker in hand before you play can also be spent to evolve an ability (see characters). Face-down Jokers count as Aces.",
		"Ace: the highest card. Only an Ace, a 2, a 10 or a Joker can go on top of an Ace.",
	]],
	["Picking up", [
		"If you cannot play, or your first card is illegal, you pick up both discard piles and your turn ends. An illegal card after your first play is blocked and ends your turn without picking anything up. A face-down card that turns out to be illegal also makes you pick up both piles.",
	]],
	["Characters, abilities and evolutions", [
		"Each player has a character with abilities. Some abilities can evolve: spend a Joker from your hand before you play any card and your turn ends, but the ability becomes its evolved version. Evolved abilities keep the base ability's behavior unless stated otherwise.",
		"Abilities whose name contains (Domain) are domains and follow Domain Clashing, below.",
	]],
];

function buildRulesPage() {
	const box = $("rules-content");
	box.replaceChildren();
	for (const [title, paragraphs] of RULES_SECTIONS) {
		box.append(el("div", { class: "panel" }, el("h2", {}, title), ...paragraphs.map((text) => el("p", {}, text))));
	}
	const multi = el("div", { class: "panel" },
		el("h2", {}, "Multi-use rules"),
		el("p", {}, "Abilities are built from these reusable rules. Characters can gain them from their abilities, and God of Jujutsu lets its owner use any of them."));
	for (const [name, text] of Object.entries(catalog.rules)) {
		multi.append(el("p", {}, el("strong", {}, name), el("br"), text));
	}
	box.append(multi);
	box.append(el("div", { class: "panel" }, el("h2", {}, "Domain Clashing"), el("pre", { class: "plain" }, catalog.domain_rule)));
}

let viewBeforeRules = "setup";

function openRules() {
	if (!$("rules-page").hidden) return;
	viewBeforeRules = !$("game").hidden ? "game" : "setup";
	$("setup").hidden = true;
	$("game").hidden = true;
	buildRulesPage();
	$("rules-page").hidden = false;
	window.scrollTo(0, 0);
	if (location.hash !== "#rules") location.hash = "rules";
}

function closeRules() {
	if ($("rules-page").hidden) return;
	$("rules-page").hidden = true;
	$(viewBeforeRules).hidden = false;
	if (location.hash === "#rules") history.replaceState(null, "", location.pathname + location.search);
}

document.querySelectorAll(".open-rules").forEach((button) => button.addEventListener("click", openRules));
$("rules-back").addEventListener("click", closeRules);
window.addEventListener("hashchange", () => {
	if (location.hash === "#rules") openRules();
	else closeRules();
});

// ---------------------------------------------------------------- admin menu

function openAdmin() {
	const status = JSON.parse(bridge.admin_status());
	const password = el("input", { type: "password", placeholder: "Admin password" });
	const message = el("p", {}, status.unlocked ? "Admin access is unlocked for this session." : "Enter the admin password to enable card editing.");
	const editButton = el("button", {
		disabled: !(status.unlocked && status.in_game),
		onclick: () => { closeDialog(); openCardEditor(); },
	}, "Edit all card values");
	const unlock = () => {
		const result = JSON.parse(bridge.admin_unlock(password.value));
		message.textContent = result.unlocked ? "Admin access unlocked for this session." : "Incorrect password.";
		editButton.disabled = !(result.unlocked && result.in_game);
		if (result.unlocked && !result.in_game) message.textContent += " Start a game to edit cards.";
	};
	password.addEventListener("keydown", (event) => { if (event.key === "Enter") unlock(); });
	showDialog("Admin access", el("div", {}, message, password, el("button", { onclick: unlock }, "Unlock"), el("br"), editButton),
		[{ label: "Close" }]);
	password.focus();
}

function openCardEditor() {
	adminOpen = true;
	let selected = null;
	let data = null;
	const list = el("select", { size: 14, class: "admin-list" });
	const rank = el("select");
	const suit = el("select");
	const message = el("p", {});
	const label = el("strong", {}, "Select a card");

	const refill = () => {
		data = JSON.parse(bridge.admin_cards());
		if (data.error) {
			message.textContent = data.error;
			return;
		}
		list.replaceChildren(...data.rows.map((row) => el("option", { value: String(row.id), selected: row.id === selected }, `${row.location}: ${row.card}`)));
		if (!rank.options.length) {
			data.ranks.forEach((value) => rank.append(el("option", { value }, value)));
			data.suits.forEach((value) => suit.append(el("option", { value }, value)));
		}
	};
	list.addEventListener("change", () => {
		selected = parseInt(list.value, 10);
		const row = data.rows[selected];
		label.textContent = `${row.location}: ${row.card}`;
		rank.value = row.rank;
		suit.value = row.suit || data.suits[0];
		suit.disabled = row.rank === "Joker";
	});
	rank.addEventListener("change", () => { suit.disabled = rank.value === "Joker"; });
	const apply = el("button", {
		onclick: () => {
			if (selected === null) return;
			const result = JSON.parse(bridge.admin_set(selected, rank.value, suit.value));
			message.textContent = result.error || result.message;
			applyState(JSON.parse(bridge.get_state()));
			refill();
		},
	}, "Apply card change");
	refill();
	showDialog("Admin card editor", el("div", { class: "admin-editor" },
		list, el("div", {}, label, el("br"), "Rank", el("br"), rank, el("br"), "Suit", el("br"), suit, el("br"), apply, message)),
	[{ label: "Close", action: () => { adminOpen = false; scheduleBot(); } }]);
}

document.querySelectorAll(".open-admin").forEach((button) => button.addEventListener("click", openAdmin));

// ---------------------------------------------------------------- bridge calls

function send(action, answers = []) {
	if (busy) return;
	const result = JSON.parse(bridge.act(JSON.stringify({ ...action, answers })));
	if (result.ask) {
		showAsk(result.ask, answers, action);
		return;
	}
	selCard = null;
	applyState(result);
}

function botTick() {
	botTimer = null;
	if (adminOpen || !state || state.phase !== "play" || !state.needs_bot) return;
	const result = JSON.parse(bridge.bot_step(fastForward ? 40 : 1));
	applyState(result);
}

function scheduleBot() {
	if (adminOpen || botTimer !== null || !state || state.phase !== "play" || !state.needs_bot || needsHandoff()) return;
	botTimer = setTimeout(botTick, fastForward ? 0 : 350);
}

function applyState(next) {
	state = next;
	if (state.phase === "over") fastForward = false;
	render();
	if (state.popup) showDialog("Six Eyes", el("p", {}, state.popup), [{ label: "OK" }]);
	scheduleBot();
	autoResolve();
}

// Pending World Cutting Slash / Limitless effects open their prompts automatically.
function autoResolve() {
	if (state.phase !== "play" || needsHandoff() || !$("modal").hidden) return;
	const ids = state.buttons.map((button) => button.id);
	if (ids.includes("resolve_slash")) setTimeout(() => send({ type: "resolve_slash" }), 0);
	else if (ids.includes("resolve_limitless")) setTimeout(() => send({ type: "resolve_limitless" }), 0);
}

function needsHandoff() {
	return Boolean(state && state.hot_seat && state.phase !== "over" && state.viewer !== confirmedViewer);
}

// ---------------------------------------------------------------- rendering

function cardFromLabel(label) {
	const joker = label.match(/^Joker(?: \((.*?)\))?$/);
	if (joker) return { rank: "Joker", suit: "", label, value: joker[1] };
	const match = label.match(/^(.*?) of (Clubs|Diamonds|Hearts|Spades)$/);
	return match ? { rank: match[1], suit: match[2], label } : { rank: label, suit: "", label };
}

function cardNode(card, options = {}) {
	const red = card.suit === "Hearts" || card.suit === "Diamonds";
	const classes = ["card"];
	if (red) classes.push("red");
	if (card.rank === "Joker") classes.push("joker");
	if (options.selected) classes.push("selected");
	if (options.compact) classes.push("compact");
	const node = el(options.onclick ? "button" : "div", {
		class: classes.join(" "),
		...(options.onclick ? { type: "button", onclick: options.onclick } : {}),
		title: card.label,
		ariaLabel: card.label,
	},
	el("span", { class: "card-rank" }, RANK_SHORT[card.rank] || card.rank),
	el("span", { class: "card-suit" }, card.rank === "Joker" ? "★" : SUIT_SYMBOLS[card.suit] || ""),
	card.value ? el("small", { class: "card-value" }, card.value) : "");
	if (options.disabled) node.disabled = true;
	return node;
}

function hiddenNode(index, known, options) {
	const node = el(options.onclick ? "button" : "div", {
		class: "card hidden" + (options.selected ? " selected" : "") + (options.compact ? " compact" : ""),
		...(options.onclick ? { type: "button", onclick: options.onclick } : {}),
		ariaLabel: "Face-down card " + (index + 1),
	}, el("span", { class: "card-back-mark", ariaHidden: true }, "✦"));
	if (known) node.append(el("small", {}, "Seen: " + known));
	return node;
}

function cardGallery(labels) {
	if (!labels.length) return el("p", { class: "empty-pile" }, "Empty");
	return el("div", { class: "card-gallery" }, ...labels.map((label) => cardNode(cardFromLabel(label), { compact: true })));
}

function render() {
	const st = state;
	if (needsHandoff()) {
		renderHandoff();
		return;
	}
	closeHandoffIfAny();
	const phaseText = st.phase === "setup" ? "Setup"
		: st.phase === "over" ? `${st.winner} finished first.`
		: `Round ${st.round}  |  Turn ${st.turn}  |  ${st.players[st.current].name}`;
	$("status").textContent = phaseText + "\n" + st.notice;
	renderPiles();
	renderPlayers();
	renderHand();
}

function renderHandoff() {
	const name = state.players[state.viewer].name;
	$("status").textContent = "Pass the device";
	showDialog("Pass the device", el("p", { class: "handoff" }, `Hand the device to ${name}. Hands stay hidden until they are ready.`), [
		{
			label: `I'm ${name} - show my cards`,
			action: () => {
				confirmedViewer = state.viewer;
				applyState(state);
			},
		},
	]);
	$("modal-buttons").dataset.handoff = "1";
}

function closeHandoffIfAny() {
	const buttons = $("modal-buttons");
	if (buttons.dataset.handoff) {
		delete buttons.dataset.handoff;
		closeDialog();
	}
}

function renderPiles() {
	const st = state;
	const topPiles = $("top-piles");
	const drawLeft = $("draw-pile-left");
	const drawRight = $("draw-pile-right");
	const discards = $("discard-piles");
	topPiles.replaceChildren();
	drawLeft.replaceChildren();
	drawRight.replaceChildren();
	discards.replaceChildren();
	st.draw_piles.forEach((count, index) => {
		const container = index === 0 ? drawLeft : drawRight;
		container.append(el("div", { class: "pile-stack draw-pile" },
			el("strong", { class: "pile-label" }, `Draw pile ${index + 1}`),
			hiddenNode(index, null, { compact: true }),
			el("small", { class: "pile-count" }, `${count} cards`)));
	});
	[["Destroyed Pile", st.destroyed], ["Deleted Pile", st.deleted]].forEach(([title, cards]) => {
		topPiles.append(el("div", { class: "pile-stack collection-pile" },
		el("strong", { class: "pile-label" }, title),
		cards.length ? cardNode(cardFromLabel(cards.at(-1)), { compact: true }) : el("div", { class: "empty-card" }),
		el("small", { class: "pile-count" }, `${cards.length} cards`),
		el("button", {
			class: "pile-view",
			type: "button",
			ariaLabel: `View ${title.toLowerCase()}`,
			onclick: () => showDialog(title, cardGallery(cards), [{ label: "Close" }]),
		}, "View pile")));
	});
	st.discards.forEach((pile, index) => {
		const canPick = st.phase === "play" && st.me.is_current;
		const node = el("div", { class: "pile-stack discard-pile" + (selPile === index ? " selected" : "") });
		node.append(el("strong", { class: "pile-label" }, `Discard Pile ${index + 1}`));
		const select = el("button", { class: "discard-select", type: "button", disabled: !canPick, ariaLabel: `Select discard pile ${index + 1}${pile.top ? `, ${pile.top}` : ", empty"}`, onclick: () => {
			if (canPick) {
				selPile = index;
				render();
			}
		} },
		pile.top ? cardNode(cardFromLabel(pile.top), { compact: true }) : el("div", { class: "empty-card" }));
		node.append(select, el("small", { class: "pile-count" }, `${pile.count} cards`));
		const viewButton = el("button", { onclick: (event) => {
			event.stopPropagation();
			showDialog(`Discard Pile ${index + 1}`, cardGallery(pile.cards), [{ label: "Close" }]);
		}, class: "pile-view" }, "View pile");
		node.append(viewButton);
		discards.append(node);
	});
}

function playerZone(title, count, cards) {
	return el("div", { class: "player-zone" },
		el("span", { class: "zone-label" }, `${title} · ${count}`),
		cards.length
			? el("div", { class: "mini-cards" }, ...cards)
			: el("div", { class: "mini-cards empty-zone" }, "Empty"));
}

function renderPlayers() {
	const left = $("left-players");
	const right = $("right-players");
	left.replaceChildren();
	right.replaceChildren();
	const opponents = state.players.filter((_, index) => index !== state.viewer);
	opponents.forEach((player, index) => {
		const handBacks = Array.from({ length: Math.min(Math.max(0, player.hand - player.revealed.length), 6) }, (_, index) => hiddenNode(index, null, { compact: true }));
		handBacks.push(...player.revealed.map((label) => cardNode(cardFromLabel(label), { compact: true })));
		const faceDownCards = player.seen.map((label) => cardNode(cardFromLabel(label), { compact: true }));
		faceDownCards.push(...Array.from({ length: Math.min(Math.max(0, player.face_down - player.seen.length), 3) }, (_, index) => hiddenNode(index, null, { compact: true })));
		const zones = [
			playerZone("Hand", player.hand, handBacks),
			playerZone("Face-up", player.face_up.length, player.face_up.map((card) => cardNode(card, { compact: true }))),
			playerZone(player.seen.length ? "Face-down / seen" : "Face-down", player.face_down, faceDownCards),
		];
		const node = el("div", { class: "player" + (player.current ? " current" : "") },
			el("strong", { class: "player-name" }, player.name),
			player.character ? el("span", { class: "player-character" }, player.character) : "",
			player.current ? el("span", { class: "current-turn" }, "Turn") : "",
			el("div", { class: "player-zones" }, zones));
		if (player.tags.length) {
			node.append(el("div", { class: "player-tags" }, ...player.tags.map((tag) => el("span", { class: "tag" }, tag))));
		}
		(index % 2 === 0 ? left : right).append(node);
	});
}

function renderHand() {
	const st = state;
	const cards = $("cards");
	const actions = $("actions");
	const draw = $("draw-choice");
	cards.replaceChildren();
	actions.replaceChildren();
	draw.replaceChildren();

	if (st.phase === "over") {
		$("hand-title").textContent = "Final standings";
		const table = el("table", { class: "standings" });
		st.standings.forEach((row) => {
			table.append(el("tr", {},
				el("td", {}, `${row.rank}.`), el("td", {}, row.name),
				el("td", {}, row.status), el("td", {}, `Round ${row.round}, Turn ${row.turn}`)));
		});
		cards.append(table);
		return;
	}

	if (st.phase === "setup") {
		$("hand-title").textContent = `${st.me.name}: choose 3 face-up cards | ${setupSel.size}/3 selected`;
		st.me.hand.forEach((card, index) => {
			cards.append(cardNode(card, {
				selected: setupSel.has(index),
				onclick: () => {
					if (setupSel.has(index)) setupSel.delete(index);
					else if (setupSel.size < 3) setupSel.add(index);
					render();
				},
			}));
		});
		actions.append(el("button", {
			class: "primary",
			disabled: setupSel.size !== 3,
			onclick: () => {
				const picks = [...setupSel];
				setupSel = new Set();
				send({ type: "setup", cards: picks });
			},
		}, "Set face-up cards"));
		return;
	}

	const me = st.me;
	const source = me.source;
	const revealing = me.mode === "reveal";
	if (!me.is_current) {
		$("hand-title").textContent = st.players[st.current].bot ? "Bots are playing" : `Waiting for ${st.players[st.current].name}`;
	} else if (revealing) {
		$("hand-title").textContent = `${me.name}: choose a card from your hand to reveal`;
	} else {
		$("hand-title").textContent = source ? `${st.hot_seat ? me.name + "'s" : "Your"} ${source.replace("_", " ")}` : "No cards available";
	}
	const handCards = me.hand.map((card, index) => {
		const active = me.is_current && (revealing || source === "hand");
		const options = active ? { selected: !revealing && selCard === index, onclick: () => revealing ? send({ type: "reveal", card: index }) : (selCard = index, render()) } : {};
		return cardNode(card, options);
	});
	const faceUpCards = me.face_up.map((card, index) => {
		const active = me.is_current && !revealing && source === "face_up";
		const options = active ? { selected: selCard === index, onclick: () => { selCard = index; render(); } } : {};
		return cardNode(card, options);
	});
	const faceDownCards = me.face_down.map((card, index) => {
		const active = me.is_current && !revealing && source === "face_down";
		const options = active ? { selected: selCard === index, onclick: () => { selCard = index; render(); } } : {};
		return hiddenNode(index, card.known, options);
	});
	cards.append(el("div", { class: "own-card-zones" },
		playerZone("Hand", me.hand.length, handCards),
		playerZone("Face-Up", me.face_up.length, faceUpCards),
		playerZone("Face-Down", me.face_down.length, faceDownCards)));

	if (st.draw_choice) {
		draw.append(el("p", { class: "draw-prompt" }, "Mastered Six Eyes: choose a card to draw."));
		for (let pileIndex = 0; pileIndex < st.draw_piles.length; pileIndex++) {
			const choices = st.draw_choice.filter((choice) => choice.pile === pileIndex);
			if (!choices.length) continue;
			draw.append(el("div", { class: "draw-choice-group" },
				el("strong", {}, `Pile ${pileIndex + 1}`),
				...choices.map((choice) => cardNode(cardFromLabel(choice.label), {
					compact: true,
					onclick: () => send({ type: "draw_pref", pile: choice.pile, depth: choice.depth }),
				}))));
		}
	}

	if (!revealing && st.all_humans_finished) {
		actions.append(el("button", { class: "primary", onclick: () => { fastForward = true; applyState(state); } }, "Skip to results"));
		return;
	}
	if (me.is_current && !revealing) {
		const canPlay = source && selCard !== null && selPile !== null && !me.pending && !st.draw_choice;
		actions.append(
			el("button", {
				class: "primary",
				disabled: !canPlay,
				onclick: () => send({ type: "play", card: selCard, pile: selPile }),
			}, source === "face_down" ? "Reveal and play" : "Play selected card"),
			el("button", { disabled: !me.can_end, onclick: () => send({ type: "end_turn" }) }, "End turn"),
		);
	}
	if (revealing) return;
	st.buttons.forEach((button) => {
		if (button.info) {
			actions.append(el("span", { class: "info" }, button.label));
			return;
		}
		const extra = button.id === "cleave" ? { pile: selPile } : {};
		const enabled = button.enabled && (button.id !== "cleave" || (selPile !== null && st.discards[selPile].count > 0));
		actions.append(el("button", { disabled: !enabled, onclick: () => send({ type: button.id, ...extra }) }, button.label));
	});
}
