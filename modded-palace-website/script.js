"use strict";

const SUIT_SYMBOLS = {Clubs: "♣", Diamonds: "♦", Hearts: "♥", Spades: "♠" };
const RANK_SHORT = { Jack: "J", Queen: "Q", King: "K", Ace: "A" };

let bridge = null;
let catalog = null;
let selectedCharacter = null;
let characterDescriptions = null;
let state = null;
let selCard = null;
let selPile = null;
let playConfirmReady = false;
let setupSel = new Set();
let confirmedViewer = null;
let fastForward = false;
let botTimer = null;
let adminOpen = false;
let playerRows = [];
let appPage = "setup";
let abilityTooltipTimer = null;
let hoveredAbility = null;
let tooltipPointer = { x: 0, y: 0 };

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
	applySetupDefaults();
	$("loading").hidden = true;
	buildSetup();
	loadCharacterDescriptions();
	renderPage();
}

try {
	boot();
} catch (error) {
	$("loading-text").textContent = "Could not start: " + error.message;
}

// ---------------------------------------------------------------- setup screen

function loadCharacterDescriptions() {
	const sheets = [...document.querySelectorAll(".character-sheet[data-character]")];
	characterDescriptions = new Map(sheets.map((sheet) => [sheet.dataset.character, sheet]));
	renderCharacterDetails();
}

function abilityDescription(button, buttons) {
	const character = state.players[state.viewer].character;
	const sheet = characterDescriptions?.get(character);
	if (!sheet) return null;
	const label = button.label.toLowerCase();
	const tracks = [...sheet.querySelectorAll(".track")].map((track) => {
		const title = track.querySelector(":scope > h3")?.textContent.trim();
		const description = track.querySelector(":scope > p:not(.rule-links)")?.textContent.trim();
		const evolutionTitle = track.querySelector(".evolution h4")?.textContent.trim();
		const evolutionDescription = track.querySelector(".evolution p:not(.rule-links)")?.textContent.trim();
		return { title, description, evolutionTitle, evolutionDescription };
	});
	const namedMatches = tracks.flatMap((track) => [
		track.title && label.includes(track.title.toLowerCase())
			? { title: track.title, description: track.description, match: track.title, track }
			: null,
		track.evolutionTitle && label.includes(track.evolutionTitle.toLowerCase())
			? { title: track.evolutionTitle, description: track.evolutionDescription, match: track.evolutionTitle, track }
			: null,
	]).filter(Boolean).sort((a, b) => b.match.length - a.match.length);
	if (namedMatches.length) {
		const match = namedMatches[0];
		if (match.title === match.track.title && match.track.evolutionTitle
			&& buttons.some((item) => item.label.toLowerCase().includes(match.track.evolutionTitle.toLowerCase()))) {
			return { title: match.track.evolutionTitle, description: match.track.evolutionDescription };
		}
		return match;
	}

	const ids = {
		cleave: "Cleave",
		enchain: "Enchain",
		resolve_slash: "World Cutting Slash",
		vow: "Binding Vow",
		simple_domain: "Simple Domain",
		god: "God of Jujutsu",
		god_rule: "God of Jujutsu",
		resolve_limitless: state.players[state.viewer].tags.includes("I-T permanent") ? "Perfected Limitless" : "Limitless Barrier",
		full_hand: "Mastered Six Eyes",
		six_eyes: buttons.some((item) => item.id === "full_hand") ? "Mastered Six Eyes" : "Six Eyes",
		card_swap: button.label.includes("6/9") || buttons.some((item) => item.id === "rescue") ? "Reversal Red" : "Lapse Blue",
		rescue: "Reversal Red",
		quick_grab: "Perfected Limitless",
	};
	const title = ids[button.id];
	if (!title) return null;
	const match = tracks.find((track) => track.title === title || track.evolutionTitle === title);
	if (!match) return null;
	return {
		title,
		description: match.title === title ? match.description : match.evolutionDescription,
	};
}

function positionAbilityTooltip() {
	const tooltip = $("ability-tooltip");
	const offset = 16;
	const maxX = window.innerWidth - tooltip.offsetWidth - 8;
	const maxY = window.innerHeight - tooltip.offsetHeight - 8;
	tooltip.style.left = `${Math.max(8, Math.min(tooltipPointer.x + offset, maxX))}px`;
	tooltip.style.top = `${Math.max(8, Math.min(tooltipPointer.y + offset, maxY))}px`;
}

function hideAbilityTooltip() {
	clearTimeout(abilityTooltipTimer);
	abilityTooltipTimer = null;
	hoveredAbility = null;
	$("ability-tooltip").hidden = true;
}

function showAbilityTooltip(target, event) {
	hoveredAbility = target;
	tooltipPointer = { x: event.clientX, y: event.clientY };
	clearTimeout(abilityTooltipTimer);
	abilityTooltipTimer = setTimeout(() => {
		if (hoveredAbility !== target || !target.isConnected) return;
		const tooltip = $("ability-tooltip");
		tooltip.querySelector(".ability-tooltip-title").textContent = target.dataset.abilityTitle;
		tooltip.querySelector(".ability-tooltip-description").textContent = target.dataset.abilityDescription;
		tooltip.hidden = false;
		positionAbilityTooltip();
	}, 2000);
}

const actionArea = $("actions");
actionArea.addEventListener("pointerover", (event) => {
	const target = event.target.closest("[data-ability-title]");
	if (!target || !actionArea.contains(target) || target === hoveredAbility) return;
	showAbilityTooltip(target, event);
});
actionArea.addEventListener("pointerout", (event) => {
	if (!hoveredAbility || hoveredAbility.contains(event.relatedTarget)) return;
	hideAbilityTooltip();
});
actionArea.addEventListener("pointermove", (event) => {
	if (!hoveredAbility?.contains(event.target)) return;
	tooltipPointer = { x: event.clientX, y: event.clientY };
	if (!$("ability-tooltip").hidden) positionAbilityTooltip();
});

function applySetupDefaults() {
	$("player-count").value = catalog.defaults.players;
	$("deck-count").value = catalog.defaults.decks;
	$("joker-count").value = catalog.defaults.jokers;
}

function renderPage() {
	const target = $(location.hash.slice(1));
	const page = target?.closest("main") || $(appPage);
	document.querySelectorAll("body > main").forEach((main) => {
		main.hidden = main !== page;
	});
	document.querySelectorAll("[data-return]").forEach((link) => {
		link.href = `#${appPage}`;
	});
	if (page?.id === "action-log") updateActionLog();
	if (target && target !== page) target.scrollIntoView();
}

function setAppPage(page) {
	appPage = page;
	history.replaceState(null, "", `#${page}`);
	renderPage();
}

function renderCharacterDetails() {
	const box = $("character-details");
	const sheet = characterDescriptions?.get(selectedCharacter);
	if (!sheet) {
		box.replaceChildren(el("p", { class: "hint" }, "Loading character descriptions..."));
		return;
	}
	box.replaceChildren(...[...sheet.children].slice(1).map((node) => node.cloneNode(true)));
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
	applySetupDefaults();
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
	confirmedViewer = null;
	fastForward = false;
	selCard = selPile = null;
	playConfirmReady = false;
	setupSel = new Set();
	setAppPage("game");
	applyState(result);
});

$("new-game").addEventListener("click", () => {
	if (!confirm("Abandon this game and return to setup?")) return;
	clearTimeout(botTimer);
	botTimer = null;
	state = null;
	selCard = selPile = null;
	playConfirmReady = false;
	setAppPage("setup");
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

function updateActionLog() {
	$("action-log-content").textContent = state ? state.log.join("\n") : "No game has started.";
}

window.addEventListener("hashchange", renderPage);

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
	const result = JSON.parse(bridge.act(JSON.stringify({ ...action, answers })));
	if (result.ask) {
		showAsk(result.ask, answers, action);
		return;
	}
	selCard = null;
	playConfirmReady = false;
	if (action.type === "play" || action.type === "end_turn") selPile = null;
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
	if (location.hash === "#action-log") updateActionLog();
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
		ariaLabel: "Face-Down card " + (index + 1),
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
			el("strong", { class: "pile-label" }, `Draw Pile ${index + 1}`),
			hiddenNode(index, null, { compact: true }),
			el("small", { class: "pile-count" }, `${count} cards`)));
	});
	[["Destroyed Pile", st.destroyed], ["Deleted Pile", st.deleted]].forEach(([title, cards]) => {
		topPiles.append(el("div", { class: "pile-stack collection-pile" },
		el("strong", { class: "pile-label" }, title),
		cards.length ? cardNode(cardFromLabel(cards.at(-1)), { compact: true }) : el("div", { class: "empty-card" }),
		el("small", { class: "pile-count" }, `${cards.length} Cards`),
		el("button", {
			class: "pile-view",
			type: "button",
			ariaLabel: `View ${title.toLowerCase()}`,
			onclick: () => showDialog(title, cardGallery(cards), [{ label: "Close" }]),
		}, "View Pile")));
	});
	st.discards.forEach((pile, index) => {
		const canPick = st.phase === "play" && st.me.is_current;
		const choosePile = () => {
			if (!canPick) return;
			if (selCard !== null && selPile === index && playConfirmReady) {
				send({ type: "play", card: selCard, pile: index });
				return;
			}
			selPile = index;
			playConfirmReady = selCard !== null;
			render();
		};
		const node = el("div", {
			class: "pile-stack discard-pile" + (selPile === index ? " selected" : ""),
			role: "button",
			tabIndex: canPick ? 0 : -1,
			ariaLabel: `Select discard pile ${index + 1}${pile.top ? `, ${pile.top}` : ", empty"}`,
			onclick: choosePile,
			onkeydown: (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					choosePile();
				}
			},
		});
		node.append(el("strong", { class: "pile-label" }, `Discard Pile ${index + 1}`));
		const select = el("div", { class: "discard-select" },
		pile.top ? cardNode(cardFromLabel(pile.top), { compact: true }) : el("div", { class: "empty-card" }));
		node.append(select, el("small", { class: "pile-count" }, `${pile.count} Cards`));
		const viewButton = el("button", { onclick: (event) => {
			event.stopPropagation();
			showDialog(`Discard Pile ${index + 1}`, cardGallery(pile.cards), [{ label: "Close" }]);
		}, class: "pile-view" }, "View Pile");
		node.append(viewButton);
		discards.append(node);
	});
	const canPrompt = st.phase === "play" && st.me.is_current && !st.me.pending && !st.draw_choice && st.me.mode !== "reveal";
	$("play-prompt").textContent = !canPrompt ? ""
		: selCard !== null && selPile !== null ? "Click pile again to play selected card."
		: [selCard === null ? "Select a card" : "", selPile === null ? "Select a pile" : ""].filter(Boolean).join(" | ");
}

function selectPlayCard(index) {
	selCard = index;
	playConfirmReady = selPile !== null;
	render();
}

function playerZone(title, count, cards, zone) {
	return el("div", { class: `player-zone zone-${zone}` },
		el("span", { class: "zone-label" }, title ? `${title} · ${count}` : `${count} cards`),
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
			playerZone("Hand", player.hand, handBacks, "hand"),
			playerZone("Face-Up", player.face_up.length, player.face_up.map((card) => cardNode(card, { compact: true })), "face-up"),
			playerZone(player.seen.length ? "Face-Down / seen" : "Face-Down", player.face_down, faceDownCards, "face-down"),
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
	hideAbilityTooltip();
	draw.replaceChildren();

	if (st.phase === "over") {
		$("hand-title").textContent = "Final Standings";
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
		$("hand-title").textContent = `Choose face-ups | ${setupSel.size}/3`;
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
		}, "Set face-ups"));
		return;
	}

	const me = st.me;
	const source = me.source;
	const revealing = me.mode === "reveal";
	if (!me.is_current) {
		$("hand-title").textContent = st.players[st.current].bot ? "Bots are playing" : `Waiting for ${st.players[st.current].name}`;
	} else if (revealing) {
		$("hand-title").textContent = "Choose a card from your hand to reveal";
	} else {
		$("hand-title").textContent = source ? "" : "No cards available";
	}
	const handCards = me.hand.map((card, index) => {
		const active = me.is_current && (revealing || source === "hand");
		const options = active ? { selected: !revealing && selCard === index, onclick: () => revealing ? send({ type: "reveal", card: index }) : selectPlayCard(index) } : {};
		return cardNode(card, options);
	});
	const faceUpCards = me.face_up.map((card, index) => {
		const active = me.is_current && !revealing && source === "face_up";
		const options = active ? { selected: selCard === index, onclick: () => selectPlayCard(index) } : {};
		return cardNode(card, options);
	});
	const faceDownCards = me.face_down.map((card, index) => {
		const active = me.is_current && !revealing && source === "face_down";
		const options = active ? { selected: selCard === index, onclick: () => selectPlayCard(index) } : {};
		return hiddenNode(index, card.known, options);
	});
	cards.append(el("div", { class: "own-card-zones" },
		playerZone("Hand", me.hand.length, handCards, "hand"),
		playerZone("Face-Up", me.face_up.length, faceUpCards, "face-up"),
		playerZone("Face-Down", me.face_down.length, faceDownCards, "face-down")));

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
		actions.append(el("button", { disabled: !me.can_end, onclick: () => send({ type: "end_turn" }) }, "End Turn"));
	}
	if (revealing) return;
	st.buttons.forEach((button) => {
		if (button.info) {
			const node = el("span", { class: "info" }, button.label);
			const ability = abilityDescription(button, st.buttons);
			if (ability?.description) {
				node.dataset.abilityTitle = ability.title;
				node.dataset.abilityDescription = ability.description;
			}
			actions.append(node);
			return;
		}
		const extra = button.id === "cleave" ? { pile: selPile } : {};
		const enabled = button.enabled && (button.id !== "cleave" || (selPile !== null && st.discards[selPile].count > 0));
		const node = el("button", { disabled: !enabled, onclick: () => send({ type: button.id, ...extra }) }, button.label);
		const ability = abilityDescription(button, st.buttons);
		if (ability?.description) {
			node.dataset.abilityTitle = ability.title;
			node.dataset.abilityDescription = ability.description;
		}
		actions.append(node);
	});
}
