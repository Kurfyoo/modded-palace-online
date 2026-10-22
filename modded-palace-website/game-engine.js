"use strict";

	(() => {
		const SUITS = ["Clubs", "Diamonds", "Hearts", "Spades"];
		const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King", "Ace"];
		const VALUES = Object.fromEntries(RANKS.map((rank, index) => [rank, index + 2]));
		const MAX_PLAYERS = 12;
		const DEFAULTS = { players: 6, decks: 3, jokers: 8 };
		const RANDOM = "Random";
		const CHARACTERS = {
			Sukuna: [
				{ ability: "Cleave", rules: ["Top card discard"], evolution: { ability: "Spider Net Cleave", rules: [] } },
				{ ability: "World Cutting Slash", rules: [], evolution: { ability: "Waffle Cutting Slash", rules: [] } },
				{ ability: "Enchain", rules: ["Soul Swap"], evolution: { ability: "Rule Workaround", rules: ["Soul Swap"] } },
				{ ability: "Binding Vow", rules: [], evolution: { ability: "Binding Vow Merchant", rules: [] } },
				{ ability: "God of Jujutsu", rules: [] },
			],
			Gojo: [
				{ ability: "Hollow Purple", rules: ["Stack destroy"], evolution: { ability: "Max Purple", rules: [] } },
				{ ability: "Limitless Barrier", rules: ["I-T"], evolution: { ability: "Perfected Limitless", rules: ["I-T", "Quick Grab"] } },
				{ ability: "Lapse Blue", rules: ["Card Swapping", "Reveal"], evolution: { ability: "Reversal Red", rules: ["Card Swapping", "Rescue Draw"] } },
				{ ability: "Six Eyes", rules: [], evolution: { ability: "Mastered Six Eyes", rules: ["Full Hand"] } },
				{ ability: "Simple Domain", rules: [] },
			],
		};
		const characterNames = Object.keys(CHARACTERS);
		const characterCatalog = characterNames.map((name) => ({
			name,
			tracks: CHARACTERS[name],
		}));

	const rankValue = (card, jokerValue = null) => card.rank === "Joker" ? (jokerValue || 14) : VALUES[card.rank];
	const cardText = (card) => card.rank === "Joker" ? "Joker" : `${card.rank} of ${card.suit}`;
	const shuffle = (items) => {
		for (let i = items.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[items[i], items[j]] = [items[j], items[i]];
		}
		return items;
	};
	const card = (rank, suit = "", deck_number = 0) => ({ rank, suit, deck_number });
	const playerName = (index, bots, humanCount) => bots[index] ? `Bot ${bots.slice(0, index + 1).filter(Boolean).length}` : humanCount === 1 ? "You" : `Player ${index + 1}`;

	class Game {
		constructor(rows, decks, jokers) {
			const bots = rows.map((row) => row.type === "Bot");
			const humanCount = bots.filter((isBot) => !isBot).length;
			let deck = [];
			for (let n = 0; n < decks; n++) for (const suit of SUITS) for (const rank of RANKS) deck.push(card(rank, suit, n));
			for (let n = 0; n < jokers; n++) deck.push(card("Joker", "", 3));
			shuffle(deck);
			this.log = [];
			this.players = rows.map((row, index) => {
				const character = row.character === RANDOM ? characterNames[Math.floor(Math.random() * characterNames.length)] : row.character;
				return {
					name: playerName(index, bots, humanCount), character, bot: bots[index],
					hand: [], face_up: [], face_down: [], ability_states: Object.fromEntries(CHARACTERS[character].map((track) => [track.ability, { removed: false, evolved: false, uses: 0, round: 0 }])),
					cut_meter: 0, is_eliminated: false, enchain_used: false, vow_card: null, god_rule: "", god_round: 0,
					revealed_cards: [], known_cards: [], it_until_round: 0, simple_domain_active: false, simple_domain_used: false,
					cleanse_round: 0, swap_round: 0, rescue_round: -99, pending_world_slashes: 0, pending_limitless_effects: [], ace_streak: 0,
				};
			});
			for (const p of this.players) {
				p.face_down = [deck.pop(), deck.pop(), deck.pop()];
				p.hand = Array.from({ length: 6 }, () => deck.pop());
			}
			this.draw_piles = [[], []];
			deck.forEach((c, i) => this.draw_piles[i % 2].push(c));
			this.draw_piles.forEach(shuffle);
			this.discards = [[], []];
			this.destroyed = [];
			for (let i = 0; i < 2; i++) {
				if (!this.draw_piles[i].length) continue;
				let c = this.draw_piles[i].pop();
				while (c.rank === "Joker" && this.draw_piles[i].some((x) => x.rank !== "Joker")) {
					this.draw_piles[i].push(c); shuffle(this.draw_piles[i]); c = this.draw_piles[i].pop();
				}
				if (c.rank === "10") this.destroyed.push(c);
				else this.discards[i].push(c);
			}
			this.pile_values = this.discards.map((pile) => pile.length ? rankValue(pile.at(-1)) : 14);
			this.pile_last_player = [null, null];
			this.pile_value_history = this.discards.map((pile) => pile.length ? [rankValue(pile.at(-1))] : []);
			this.pile_owner_history = this.discards.map((pile) => pile.length ? [null] : []);
			this.deleted = [];
			this.current = 0;
			this.turn = 1;
			this.round = 1;
			this.cards_played = 0;
			this.turn_pile = null;
			this.winner = null;
			this.finish_order = [];
			this.last_drawn = [];
			this.domains = [];
			this.enchain_player = null;
			this.enchain_remaining = 0;
			this.pending_quick_grabs = [];
			this.pending_reveals = [];
			this.drawPref = null;
			this.human_has_played = false;
			this.notice = "Choose three cards to keep face-up for later.";
			this.popup = null;
			this.bot_messages = [];
			this.record("Game started.");
		}
		record(message) { this.log.push(`${new Date().toLocaleString()} | ${message}`); }
		effective(index, base = null) {
			const p = this.players[index];
			for (const track of CHARACTERS[p.character]) {
				if (track.ability !== base && track.evolution?.ability !== base) continue;
				const state = p.ability_states[track.ability];
				if (state.evolved) return track.evolution.ability;
				if (state.removed || track.ability !== base) return null;
				return track.ability;
			}
			return null;
		}
		has(index, ability) { return this.effective(index, ability) !== null; }
		immune(index) {
			const p = this.players[index];
			return this.effective(index, "Limitless Barrier") === "Perfected Limitless"
				|| this.round <= p.it_until_round || p.god_rule === "I-T"
				|| this.enchain_player === index && this.enchain_remaining > 0;
		}
		hasRule(index, rule) {
			const p = this.players[index];
			if (p.god_rule === rule) return true;
			return CHARACTERS[p.character].some((track) => {
				const state = p.ability_states[track.ability];
				if (!state || state.removed) return false;
				const granted = state.evolved ? track.evolution.rules : track.rules;
				const active = state.evolved ? track.evolution.ability : track.ability;
				return active === rule || (granted || []).includes(rule);
			});
		}
		finished(index) {
			const p = this.players[index];
			return p.is_eliminated || this.finish_order.some((row) => row.index === index);
		}
		bindingVowCards(index) {
			const p = this.players[index];
			if (p.hand.length) return p.hand;
			return this.draw_piles.some((pile) => pile.length) ? [] : p.face_up;
		}
		source(index) {
			const p = this.players[index];
			if (p.hand.length) return ["hand", p.hand];
			if (this.draw_piles.some((pile) => pile.length)) return ["hand", p.hand];
			if (p.face_up.length) return ["face_up", p.face_up];
			if (p.face_down.length) return ["face_down", p.face_down];
			return [null, []];
		}
		mustEnchain(index) {
			if (this.enchain_player !== index || this.enchain_remaining <= 0) return false;
			const p = this.players[index];
			if (!p.hand.length && this.draw_piles.some((pile) => pile.length)) return false;
			const [, cards] = this.source(index);
			return cards.some((c) => [0, 1].some((pile) => this.legal(c, pile, c.rank === "Joker" ? 14 : null)));
		}
		legal(cardObj, pile, jokerValue = null) {
			if (this.cards_played && pile !== this.turn_pile) return false;
			const p = this.players[this.current];
			if (this.enchain_remaining && this.enchain_player === this.current && this.effective(this.current, "Enchain") === "Rule Workaround") return true;
			if (!this.discards[pile].length) return true;
			const playsAsVow = p.vow_card === cardObj;
			const value = playsAsVow ? 13 : rankValue(cardObj, jokerValue);
			if (this.effective(this.current, "World Cutting Slash") === "Waffle Cutting Slash" && value === 13) return true;
			if (this.effective(this.current, "Binding Vow") === "Binding Vow Merchant" && this.pile_last_player[pile] === this.current && this.pile_values[pile] === 13) return true;
			if (value === 2) return this.cards_played === 0 || [2, 14].includes(this.pile_values[pile]);
			if (value === 10 && this.cards_played === 0) return true;
			if (this.cards_played && this.pile_last_player[pile] === this.current) return value >= this.pile_values[pile] && value <= this.pile_values[pile] + 1;
			return cardObj.rank === "Joker" || value >= this.pile_values[pile];
		}
		refill(index) {
			const p = this.players[index];
			this.last_drawn = [];
			while (p.hand.length < 3 && this.draw_piles.some((pile) => pile.length)) {
				if (index === this.current && this.drawPref) {
					const [preferredPile, depth] = this.drawPref;
					const pile = this.draw_piles[preferredPile];
					if (pile && pile.length > depth) {
						const [drawn] = pile.splice(pile.length - 1 - depth, 1);
						p.hand.push(drawn);
						this.last_drawn.push(drawn);
						this.drawPref = null;
						continue;
					}
					this.drawPref = null;
				}
				const pileIndex = this.draw_piles.findIndex((pile) => pile.length);
				const drawn = this.draw_piles[pileIndex].pop();
				p.hand.push(drawn);
				this.last_drawn.push(drawn);
			}
		}
		remember(viewer, c, owner = viewer) {
			const known = this.players[viewer].known_cards;
			this.players[viewer].known_cards = known.filter((row) => row.c !== c);
			this.players[viewer].known_cards.push({ c, owner });
		}
		known(viewer, c) { return this.players[viewer].known_cards.some((row) => row.c === c); }
		place(c, pileIndex, jokerValue = null, source = "hand") {
			const pile = this.discards[pileIndex];
			const p = this.players[this.current];
			const actual = p[source];
			const previous = this.pile_values[pileIndex];
			const vow = p.vow_card === c;
			const value = vow ? 13 : rankValue(c, jokerValue);
			const sameStack = pile.length && this.pile_last_player[pileIndex] === this.current && value === previous;
			const maxPurple = this.effective(this.current, "Hollow Purple") === "Max Purple" && this.cards_played % 3 === 2;
			const stackDestroy = Boolean(maxPurple || (sameStack && (this.has(this.current, "Hollow Purple") || p.god_rule === "Stack destroy")));
			pile.push(c);
			this.pile_values[pileIndex] = value;
			this.pile_last_player[pileIndex] = this.current;
			this.pile_value_history[pileIndex].push(value);
			this.pile_owner_history[pileIndex].push(this.current);
			this.turn_pile = pileIndex;
			this.cards_played++;
			if (this.enchain_player === this.current && this.enchain_remaining > 0) this.enchain_remaining--;
			if (source !== "draw") actual.splice(actual.indexOf(c), 1);
			for (const player of this.players) {
				player.known_cards = player.known_cards.filter((known) => known.c !== c);
				player.revealed_cards = player.revealed_cards.filter((known) => known !== c);
			}
			if (vow) p.vow_card = null;
			if (!vow && (c.rank === "10" || c.rank === "Joker" && jokerValue === 10)) {
				this.destroyed.push(...pile.splice(0));
				this.pile_values[pileIndex] = 14;
				this.pile_last_player[pileIndex] = null;
				this.pile_value_history[pileIndex] = [];
				this.pile_owner_history[pileIndex] = [];
				this.record(`${p.name} played ${c.rank === "10" ? "a 10" : "a Joker as 10"}; the discard pile was destroyed.`);
			} else if (stackDestroy) {
				this.destroyed.push(...pile.splice(0));
				this.pile_values[pileIndex] = 14;
				this.pile_last_player[pileIndex] = null;
				this.pile_value_history[pileIndex] = [];
				this.pile_owner_history[pileIndex] = [];
				this.record(`${p.name} triggered Hollow Purple on discard pile ${pileIndex + 1}.`);
			} else {
				const label = vow ? `${cardText(c)} as a King (Binding Vow)` : c.rank === "Joker" ? `Joker as ${RANKS[value - 2]}` : cardText(c);
				this.record(`${p.name} played ${label} on discard pile ${pileIndex + 1}.`);
			}
			if (source === "hand") this.refill(this.current);
			if (value === 13 && this.has(this.current, "World Cutting Slash")) p.pending_world_slashes += this.effective(this.current, "World Cutting Slash") === "Waffle Cutting Slash" ? 3 : 1;
			if (value === 14 && ["Limitless Barrier", "Perfected Limitless"].includes(this.effective(this.current, "Limitless Barrier"))) {
				p.ace_streak++;
				if (p.ace_streak <= 2) p.it_until_round = Math.max(p.it_until_round, this.round + 1);
				else if (p.ace_streak === 3) p.it_until_round = Math.max(p.it_until_round, this.round + 2);
				if (p.ace_streak === 2) p.pending_limitless_effects.push("pick_one_face_down");
				else if (p.ace_streak === 3) p.pending_limitless_effects.push("pick_all_face_down");
				else if (p.ace_streak === 4 && this.effective(this.current, "Limitless Barrier") !== "Perfected Limitless") {
					p.ability_states["Limitless Barrier"].evolved = true;
					p.pending_limitless_effects.push("replace_hand_from_deleted");
				}
			} else if (!stackDestroy) p.ace_streak = 0;
			if (value === 14) {
				const targets = this.players.map((target, index) => ({ target, index })).filter(({ target, index }) =>
					index !== this.current && !target.is_eliminated && !this.finished(index) && !this.immune(this.current)
					&& (this.effective(index, "Limitless Barrier") === "Perfected Limitless" && value === 14
						|| target.god_rule === "Quick Grab" && target.god_grab_value === value));
				if (targets.length) this.pending_quick_grabs.push({
					card: c,
					pile_index: pileIndex,
					played_by: this.current,
					zone: this.destroyed.includes(c) ? "destroyed_pile" : "discard_pile",
					targets: targets.map(({ index }) => index),
				});
			}
			this.checkWinner();
			return c;
		}
		play(index, source, cardIndex, pile, jokerValue = null) {
			const p = this.players[index];
			const c = p[source][cardIndex];
			if (!c) return null;
			if (!this.legal(c, pile, jokerValue)) {
				if (!this.cards_played) this.takePiles(index);
				return null;
			}
			return this.place(c, pile, jokerValue, source);
		}
		playDown(index, cardIndex, pile) {
			const p = this.players[index];
			const c = p.face_down.splice(cardIndex, 1)[0];
			if (!c) return [null, false];
			if (!this.legal(c, pile, c.rank === "Joker" ? 14 : null)) {
				p.hand.push(c);
				this.takePiles(index);
				return [c, false];
			}
			p.face_down.splice(cardIndex, 0, c);
			return [this.place(c, pile, 14, "face_down"), true];
		}
		takePiles(index) {
			const p = this.players[index];
			for (const pile of this.discards) p.hand.push(...pile.splice(0));
			this.pile_values = [14, 14];
			this.pile_last_player = [null, null];
			this.pile_value_history = [[], []];
			this.pile_owner_history = [[], []];
			this.cards_played = 0;
			this.turn_pile = null;
			this.shatterDomain(index);
			this.record(`${p.name} picked up both discard piles.`);
		}
		checkWinner() {
			if (this.draw_piles.some((pile) => pile.length)
				|| this.pending_quick_grabs.length
				|| this.players.some((player) => player.pending_world_slashes || player.pending_limitless_effects.length)) return;
			const completed = new Set(this.finish_order.map((row) => row.index));
			for (let index = 0; index < this.players.length; index++) {
				const p = this.players[index];
				if (!completed.has(index) && !p.is_eliminated && !p.hand.length && !p.face_up.length && !p.face_down.length) {
					this.finish_order.push({ index, rank: this.finish_order.length + 1, status: "finished", round: this.round, turn: this.turn });
				}
			}
			const finished = new Set(this.finish_order.map((row) => row.index));
			const remaining = this.players.map((_, index) => index).filter((index) => !finished.has(index) && !this.players[index].is_eliminated);
			const eliminated = this.players.map((_, index) => index).filter((index) => !finished.has(index) && this.players[index].is_eliminated);
			if (remaining.length <= 1) {
				const lastRank = this.finish_order.length + 1;
				if (remaining.length) this.finish_order.push({ index: remaining[0], rank: lastRank, status: "last remaining", round: this.round, turn: this.turn });
				for (const index of eliminated) this.finish_order.push({ index, rank: lastRank, status: "last place (Cut Meter)", round: this.round, turn: this.turn });
				this.winner = this.finish_order[0]?.index ?? remaining[0] ?? null;
			}
		}
		endTurn() {
			if (this.winner !== null) return;
			this.checkWinner();
			if (this.winner !== null) return;
			this.record(`${this.players[this.current].name} ended their turn.`);
			if (this.enchain_return) {
				const saved = this.enchain_return;
				this.enchain_return = null;
				this.enchain_player = null;
				this.enchain_remaining = 0;
				this.current = saved.current;
				this.cards_played = saved.cards_played;
				this.turn_pile = saved.turn_pile;
				this.human_has_played = saved.human_has_played;
				return;
			}
			this.cards_played = 0; this.turn_pile = null;
			this.enchain_player = null;
			this.enchain_remaining = 0;
			const old = this.current;
			this.current = (this.current + 1) % this.players.length;
			while (this.finished(this.current) && this.winner === null) this.current = (this.current + 1) % this.players.length;
			if (this.current <= old) {
				this.round++;
				for (const p of this.players) {
					if (p.god_round < this.round) p.god_rule = "";
				}
				this.tickDomains();
			}
			this.turn++;
			this.human_has_played = false;
			const p = this.players[this.current];
			if (this.effective(this.current, "Six Eyes") === "Mastered Six Eyes") {
				for (let owner = 0; owner < this.players.length; owner++) {
					if (owner !== this.current && !this.immune(owner)) {
						for (const c of [...this.players[owner].hand, ...this.players[owner].face_down]) this.remember(this.current, c, owner);
					}
				}
			}
			if (!(p && !p.bot && this.effective(this.current, "Six Eyes") === "Mastered Six Eyes" && p.hand.length < 3)) this.refill(this.current);
		}
		shatterDomain(index) { this.domains = this.domains.filter((domain) => domain.owner !== index); this.players[index].simple_domain_active = false; }
		tickDomains() {
			for (const domain of this.domains) {
				if (domain.duration !== null) domain.duration--;
				if (this.domains.length > 1) domain.refinement--;
			}
			this.domains = this.domains.filter((domain) => domain.duration === null || domain.duration > 0 && (this.domains.length < 2 || domain.refinement > 0));
		}
	}

	class Bridge {
		constructor() { this.reset(); this.admin = false; }
		reset() {
			this.game = null; this.setupQueue = []; this.setupPlayer = 0; this.setupComplete = false; this.lastHuman = 0;
			this.notice = ""; this.popup = null; this.autoEnd = false; this.drawPref = null;
		}
		humans() { return this.game.players.map((p, i) => !p.bot ? i : -1).filter((i) => i >= 0); }
		hotSeat() { return this.humans().length > 1; }
		viewer() {
			if (!this.setupComplete) return this.setupPlayer;
			const grab = this.quickGrabTarget();
			if (grab !== null) return grab;
			const revealed = this.game.pending_reveals.find((i) => !this.game.players[i].bot);
			if (revealed !== undefined) return revealed;
			const current = this.game.current;
			if (!this.game.players[current].bot) this.lastHuman = current;
			return this.lastHuman;
		}
		you(index) { return this.hotSeat() ? this.game.players[index].name : "You"; }
		get_catalog() {
			return JSON.stringify({ characters: characterCatalog, max_players: MAX_PLAYERS, defaults: DEFAULTS, random: RANDOM });
		}
		new_game(settingsText) {
			const settings = JSON.parse(settingsText);
			try {
				const rows = settings.players || [];
				const decks = Number(settings.decks), jokers = Number(settings.jokers);
				if (rows.length < 2 || rows.length > MAX_PLAYERS) throw Error(`Players must be between 2 and ${MAX_PLAYERS}`);
				if (!Number.isInteger(decks) || decks < 1) throw Error("At least one deck is required");
				if (!Number.isInteger(jokers) || jokers < 0) throw Error("Jokers cannot be negative");
				const count = decks * 52 + jokers, needed = rows.length * 9 + 4;
				if (count < needed) throw Error(`${rows.length} players need at least ${needed} cards, but only ${count} are in the deck`);
				if (rows.some((row) => !["Human", "Bot"].includes(row.type))) throw Error("Choose Human or Bot for each player");
				if (rows.every((row) => row.type === "Bot")) throw Error("At least one player must be a human");
				if (rows.some((row) => row.character !== RANDOM && !CHARACTERS[row.character])) throw Error("Choose a valid character");
				this.reset(); this.game = new Game(rows, decks, jokers);
				const humans = this.humans();
				for (const i of rows.map((_, i) => i).filter((i) => this.game.players[i].bot)) {
					const p = this.game.players[i];
					p.face_up = [...p.hand].sort((a, b) => rankValue(b) - rankValue(a)).slice(0, 3);
					p.hand = p.hand.filter((c) => !p.face_up.includes(c));
				}
				this.setupQueue = humans; this.setupPlayer = humans[0]; this.lastHuman = humans[0];
				return this.get_state();
			} catch (error) { return JSON.stringify({ error: error.message }); }
		}
		get_state() {
			const g = this.game;
			if (!g) return JSON.stringify({ phase: "none" });
			const viewer = this.viewer(), me = g.players[viewer];
			const state = {
				notice: this.notice, popup: this.popup, round: g.round, turn: g.turn, current: g.current, viewer,
				hot_seat: this.hotSeat(), draw_piles: g.draw_piles.map((pile) => pile.length),
				discards: g.discards.map((pile, i) => ({ top: pile.length ? this.playedLabel(pile.at(-1), g.pile_values[i]) : null, count: pile.length, cards: pile.map(cardText) })),
				destroyed: g.destroyed.map(cardText), deleted: g.deleted.map(cardText), log: g.log.slice(-80),
				players: g.players.map((p, i) => ({
					name: p.name, character: p.character, bot: p.bot, current: i === g.current && g.winner === null,
					hand: p.hand.length, face_down: p.face_down.length, face_up: p.face_up.map((c) => this.cardInfo(c)),
					revealed: p.revealed_cards.map(cardText), seen: i === viewer ? [] : g.players[viewer].known_cards.filter((row) => row.owner === i).map((row) => cardText(row.c)), tags: this.tags(i),
				})),
			};
			this.popup = null;
			if (g.winner !== null) {
				state.phase = "over"; state.winner = g.players[g.winner].name;
				state.standings = g.finish_order.map((row) => ({ rank: row.rank, name: g.players[row.index].name, status: row.status === "last remaining" ? "last player standing" : "finished", round: row.round, turn: row.turn }));
				return JSON.stringify(state);
			}
			if (!this.setupComplete) {
				state.phase = "setup"; state.me = { name: me.name, hand: me.hand.map((c) => this.cardInfo(c)), face_up: [], face_down: [], source: "setup" };
				return JSON.stringify(state);
			}
			const current = g.current === viewer;
			const [source] = current ? g.source(viewer) : [null];
			state.phase = "play";
			state.me = {
				name: me.name, hand: me.hand.map((c) => this.cardInfo(c)), face_up: me.face_up.map((c) => this.cardInfo(c)),
				face_down: me.face_down.map((c) => ({ known: g.known(viewer, c) ? cardText(c) : null })),
				source, pending: current && Boolean(me.pending_world_slashes || me.pending_limitless_effects.length),
				can_end: current && g.human_has_played && !me.pending_world_slashes && !me.pending_limitless_effects.length && !g.mustEnchain(viewer),
				is_current: current,
			};
			if (g.pending_reveals.includes(viewer)) state.me.mode = "reveal";
			state.buttons = this.buttons(viewer);
			state.all_humans_finished = this.humans().every((i) => g.finished(i));
			state.needs_bot = this.needsBot();
			if (this.needsDrawChoice()) state.draw_choice = g.draw_piles.flatMap((pile, pi) => pile.slice(-3).reverse().map((c, depth) => ({ pile: pi, depth, label: cardText(c) })));
			return JSON.stringify(state);
		}
		cardInfo(c) { return { label: cardText(c), rank: c.rank, suit: c.suit }; }
		playedLabel(c, value) { return c.rank === "Joker" ? `Joker (${RANKS[(value || 14) - 2]})` : cardText(c); }
		tags(i) {
			const g = this.game, p = g.players[i], tags = [];
			if (p.character === "Sukuna") tags.push(`Cut Meter ${p.cut_meter}/9`);
			if (g.effective(i, "Limitless Barrier") === "Perfected Limitless") tags.push("I-T permanent");
			else if (g.round <= p.it_until_round || p.god_rule === "I-T") tags.push("I-T active");
			if (p.is_eliminated) tags.push("ELIMINATED"); else if (this.setupComplete && g.finished(i)) tags.push("Finished");
			if (p.simple_domain_active) tags.push("Simple Domain (refinement 3)");
			for (const d of g.domains.filter((item) => item.owner === i)) tags.push(`${d.name}: refinement ${d.refinement}${g.domains.length > 1 ? " (clashing)" : ""}${d.duration === null ? "" : `, ${d.duration} round(s) left`}`);
			return tags;
		}
		needsDrawChoice() {
			const g = this.game, p = g.players[g.current];
			return this.setupComplete && g.winner === null && !p.bot && g.cards_played === 0 && p.hand.length < 3 && g.draw_piles.some((pile) => pile.length) && !this.drawPref && g.effective(g.current, "Six Eyes") === "Mastered Six Eyes" && !g.finished(g.current);
		}
		needsBot() {
			const g = this.game;
			if (!g || !this.setupComplete || g.winner !== null || this.quickGrabTarget() !== null) return false;
			if (g.pending_reveals.some((i) => !g.players[i].bot)) return false;
			return g.players[g.current].bot || g.finished(g.current);
		}
		quickGrabTarget() {
			const event = this.game?.pending_quick_grabs[0];
			return event?.targets.find((i) => !this.game.players[i].bot) ?? null;
		}
		buttons(i) {
			const g = this.game, p = g.players[i], current = g.current === i, buttons = [];
			const add = (id, label, enabled = true, info = false) => buttons.push({ id, label, enabled, info });
			const cleave = g.effective(i, "Cleave") || (p.god_rule === "Top card discard" ? "Cleave" : null);
			if (cleave) {
				const uses = p.ability_states.Cleave || { round: -1, uses: 0 };
				const remaining = uses.round === g.round ? Math.max(0, (cleave === "Spider Net Cleave" ? 5 : 1) - uses.uses) : (cleave === "Spider Net Cleave" ? 5 : 1);
				add("cleave", `Use ${cleave} (${remaining} left) - pick a discard pile first`, current && remaining > 0);
			}
			if (g.effective(i, "World Cutting Slash")) add("info", `${g.effective(i, "World Cutting Slash")} active`, false, true);
			if (g.effective(i, "Hollow Purple")) add("info", `${g.effective(i, "Hollow Purple")} active`, false, true);
			if (this.humans().some((n) => this.canEnchain(n))) add("enchain", "Enchain / Rule Workaround (once per game)");
			if (current && this.canCardSwap(i)) add("card_swap", `Card Swapping (${this.swapRanks(i).join("/") }s, once per round)`);
			if (current && this.canRescue(i)) add("rescue", "Rescue Draw");
			if (current && (g.effective(i, "Six Eyes") === "Six Eyes" || g.effective(i, "Six Eyes") === "Mastered Six Eyes") && p.six_eyes_turn !== g.turn) add("six_eyes", "Six Eyes");
			if (current && g.hasRule(i, "Full Hand") && (p.face_up.length || p.face_down.length)) add("full_hand", "Full Hand");
			if (g.domains.length) add("domain", "Domain (clash)");
			if (g.effective(i, "Simple Domain") && !p.simple_domain_used) add("simple_domain", "Simple Domain (once per game)");
			else if (g.effective(i, "Simple Domain") && p.simple_domain_active && p.cleanse_round !== g.round && p.hand.length && (p.cut_meter > 0 || p.revealed_cards.length)) add("simple_domain", "Simple Domain: discard a card to remove an effect");
			if (current && g.effective(i, "God of Jujutsu") && p.god_round !== g.round) add("god", "God of Jujutsu (choose a rule for this round)");
			if (current && p.god_rule && !["Stack destroy", "I-T", "Quick Grab", "Full Hand", "Rescue Draw", "Card Swapping"].includes(p.god_rule)) add("god_rule", `Use God of Jujutsu: ${p.god_rule}`);
			if (p.god_rule) add("info", `God of Jujutsu: ${p.god_rule} this round`, false, true);
			if (current && g.effective(i, "Binding Vow") && !p.vow_card && g.bindingVowCards(i).length) add("vow", "Binding Vow (pass turn, one card plays as a King)");
			if (p.vow_card) add("info", `Binding Vow: ${cardText(p.vow_card)} plays as a King`, false, true);
			if (current && p.pending_world_slashes) add("resolve_slash", `Resolve World Cutting Slash (${p.pending_world_slashes})`);
			if (current && p.pending_limitless_effects.length) add("resolve_limitless", `Resolve Limitless effect (${p.pending_limitless_effects.length})`);
			if (g.pending_quick_grabs[0]?.targets.includes(i)) {
				add("quick_grab", "Quick Grab the card");
				add("decline_quick_grab", "Decline Quick Grab");
			}
			if (current && g.cards_played === 0 && this.evolvable(i).length && p.hand.some((c) => c.rank === "Joker")) add("evolve", "Evolve ability (ends turn): " + this.evolvable(i).map((t) => t.evolution.ability).join(", "));
			return buttons;
		}
		evolvable(i) {
			const p = this.game.players[i];
			return CHARACTERS[p.character].filter((track) => track.evolution && !p.ability_states[track.ability].removed && !p.ability_states[track.ability].evolved);
		}
		canEnchain(i) {
			const g = this.game, p = g.players[i], ability = g.effective(i, "Enchain");
			return Boolean(g.winner === null && ability && !p.enchain_used && !g.finished(i)
				&& !g.pending_quick_grabs.length && !g.players.some((player) => player.pending_world_slashes || player.pending_limitless_effects.length)
				&& (i !== g.current || g.cards_played === 0) && this.enchainTargets(i, ability).length);
		}
		enchainTargets(i, ability = this.game.effective(i, "Enchain")) {
			const g = this.game;
			return g.players.map((target, index) => index).filter((index) => index !== i
				&& !g.players[index].is_eliminated && !g.finished(index)
				&& !g.has(index, "God of Jujutsu")
				&& (ability === "Rule Workaround" || !g.immune(index)));
		}
		canRescue(i) {
			const g = this.game;
			return g.hasRule(i, "Rescue Draw") && g.round - g.players[i].rescue_round >= 2;
		}
		swapRanks(i) {
			const g = this.game, ability = g.effective(i, "Lapse Blue"), ranks = new Set();
			if (ability === "Lapse Blue") ranks.add("5");
			if (ability === "Reversal Red") ["5", "6", "9"].forEach((rank) => ranks.add(rank));
			if (g.players[i].god_rule === "Card Swapping" && g.players[i].god_grab_value >= 2) ranks.add(RANKS[g.players[i].god_grab_value - 2]);
			return [...ranks];
		}
		cardSwapChoices(i) {
			const g = this.game, player = g.players[i], ranks = this.swapRanks(i);
			const own = ["hand", "face_up", "face_down"].flatMap((zone) => player[zone].flatMap((card, index) =>
				ranks.includes(card.rank) && (zone !== "face_down" || g.known(i, card)) ? [{ zone, index, card }] : []));
			const targets = [];
			for (let owner = 0; owner < g.players.length; owner++) {
				const target = g.players[owner];
				if (owner === i || target.is_eliminated || g.finished(owner) || g.immune(owner) || g.has(owner, "God of Jujutsu")) continue;
				target.face_up.forEach((card, index) => targets.push({ owner, zone: "face_up", index, card }));
				target.hand.forEach((card, index) => {
					if (target.revealed_cards.includes(card) || g.known(i, card)) targets.push({ owner, zone: "hand", index, card });
				});
				target.face_down.forEach((card, index) => {
					if (g.known(i, card)) targets.push({ owner, zone: "face_down", index, card });
				});
			}
			g.discards.forEach((cards, pile) => cards.forEach((card, index) => targets.push({ owner: -1, zone: "discard_pile", pile, index, card })));
			g.destroyed.forEach((card, index) => targets.push({ owner: -1, zone: "destroyed", index, card }));
			return { own, targets };
		}
		canCardSwap(i) {
			const g = this.game;
			if (!this.swapRanks(i).length || g.players[i].swap_round === g.round || g.finished(i)) return false;
			const options = this.cardSwapChoices(i);
			return Boolean(options.own.length && options.targets.length);
		}
		ask(title, options, answers) {
			const index = answers.pos < answers.values.length ? answers.values[answers.pos++] : -1;
			if (index < 0) throw { title, options };
			if (!Number.isInteger(index) || index >= options.length) throw new Error("That choice is no longer available");
			return index;
		}
		act(actionText) {
			const action = JSON.parse(actionText);
			const g = this.game;
			if (!g) return this.get_state();
			const answers = { values: action.answers || [], pos: 0 };
			try {
				const type = action.type;
				if (type === "setup") this.setup(action);
				else if (type === "play") this.playAction(action, answers);
				else if (type === "end_turn") this.endAction();
				else if (type === "draw_pref") {
						if (!this.needsDrawChoice() || !g.draw_piles[action.pile] || action.depth < 0 || action.depth >= g.draw_piles[action.pile].length) return this.get_state();
					this.drawPref = [action.pile, action.depth];
					g.drawPref = this.drawPref;
					this.notice = "Mastered Six Eyes: chosen card will be drawn.";
					g.refill(g.current);
					this.drawPref = null;
				}
				else if (type === "take_piles") this.takePilesAction();
				else if (type === "cleave") this.cleave(action, answers);
				else if (type === "enchain") this.enchain(answers);
				else if (type === "card_swap") this.cardSwap(answers);
				else if (type === "reveal") this.reveal(action);
				else if (type === "six_eyes") this.sixEyes(answers);
				else if (type === "full_hand") this.fullHand();
				else if (type === "rescue") this.rescue(answers);
				else if (type === "god") this.god(answers);
				else if (type === "god_rule") this.useGodRule(answers);
				else if (type === "vow") this.vow(answers);
				else if (type === "evolve") this.evolve(answers);
				else if (type === "simple_domain") this.simpleDomain(answers);
				else if (type === "domain") this.domain(answers);
				else if (type === "quick_grab" || type === "decline_quick_grab") this.quickGrab(type === "quick_grab");
				else if (type === "resolve_slash") this.resolveSlash(answers);
				else if (type === "resolve_limitless") this.resolveLimitless(answers);
				this.autoProgress();
			} catch (error) {
				if (error && error.options) return JSON.stringify({ ask: { title: error.title, options: error.options } });
				this.notice = error.message || String(error);
			}
			return this.get_state();
		}
		setup(action) {
			if (this.setupComplete) return;
			const picks = [...new Set(action.cards || [])].sort((a, b) => a - b);
			if (picks.length !== 3 || picks.some((i) => i < 0 || i >= this.game.players[this.setupPlayer].hand.length)) throw new Error("Choose three different cards");
			const p = this.game.players[this.setupPlayer], selected = new Set(picks);
			p.face_up = p.hand.filter((_, i) => selected.has(i));
			p.hand = p.hand.filter((_, i) => !selected.has(i));
			const position = this.setupQueue.indexOf(this.setupPlayer);
			if (position + 1 < this.setupQueue.length) {
				this.setupPlayer = this.setupQueue[position + 1];
				this.notice = "Choose three cards to keep face-up for later.";
			} else {
				this.setupComplete = true;
				this.notice = "Select a card and a discard pile, then play.";
			}
		}
		playAction(action, answers) {
			const g = this.game, current = g.current, p = g.players[current];
			if (p.bot || this.needsDrawChoice() || g.pending_reveals.length) return;
			const [source, cards] = g.source(current), cardIndex = Number(action.card), pile = Number(action.pile);
			if (!source || cardIndex < 0 || cardIndex >= cards.length || ![0, 1].includes(pile) || p.pending_world_slashes || p.pending_limitless_effects.length) return;
			const c = cards[cardIndex];
			if (source === "face_down") {
				const [played, success] = g.playDown(current, cardIndex, pile);
				if (!success) {
					this.notice = `${this.you(current)} revealed ${cardText(played)} and picked up both discard piles.`;
					this.finishTurn();
					return;
				}
				this.notice = `${this.you(current)} revealed and played ${this.playedLabel(played, 14)}.`;
				this.autoEnd = true;
				g.human_has_played = true;
				return;
			}
			const jokerValue = c.rank === "Joker" ? this.ask("Joker value", RANKS, answers) + 2 : null;
			const first = g.cards_played === 0;
			const played = g.play(current, source, cardIndex, pile, jokerValue);
			if (!played) {
				this.notice = first ? `Illegal first play. ${this.you(current)} picked up both discard piles.` : "Illegal follow-up blocked. The piles were left unchanged.";
				this.finishTurn();
				return;
			}
			g.human_has_played = true;
			this.notice = `${this.you(current)} played ${this.playedLabel(played, jokerValue)}.${source === "hand" && g.last_drawn.length ? ` Drew ${g.last_drawn.length} card(s).` : ""}`;
		}
		finishTurn() {
			const g = this.game;
			this.autoEnd = false;
			if (g.winner !== null) return;
			g.endTurn();
			g.human_has_played = g.cards_played > 0;
		}
		endAction() {
			const g = this.game, i = g.current, p = g.players[i];
			if (!g.human_has_played || p.pending_world_slashes || p.pending_limitless_effects.length || g.mustEnchain(i)) return;
			this.finishTurn();
		}
		takePilesAction() {
			const g = this.game, i = g.current;
			if (g.players[i].bot) return;
			g.takePiles(i); this.notice = `No legal plays. ${this.you(i)} picked up both discard piles.`; this.finishTurn();
		}
		autoProgress() {
			const g = this.game;
			for (let count = 0; count < 50 && g && this.setupComplete && g.winner === null; count++) {
				while (g.pending_quick_grabs.length && !g.pending_quick_grabs[0].targets.some((i) => !g.players[i].bot)) {
					this.resolveQuickGrab(g.pending_quick_grabs[0].targets[0], true);
				}
				if (this.quickGrabTarget() !== null) return;
				const i = g.current, p = g.players[i];
				if (p.bot || this.needsDrawChoice() || g.pending_reveals.length) return;
				if (p.hand.length < 3 && g.draw_piles.some((pile) => pile.length)) g.refill(i);
				if (this.autoEnd && !p.pending_world_slashes && !p.pending_limitless_effects.length) { this.finishTurn(); continue; }
				if (p.pending_world_slashes || p.pending_limitless_effects.length) return;
				const [source, cards] = g.source(i);
				if (!source) { this.finishTurn(); continue; }
				if (source !== "face_down" && !cards.some((c) => [0, 1].some((pile) => g.legal(c, pile, c.rank === "Joker" ? 14 : null)))) {
					if (g.enchain_return && g.cards_played < 2) { this.finishTurn(); continue; }
					if (!g.cards_played) {
						g.takePiles(i); this.notice = `No legal plays. ${this.you(i)} picked up both discard piles.`; this.finishTurn(); continue;
					}
					this.notice = "No legal follow-up plays. End your turn to continue.";
				}
				return;
			}
		}
		evolve(answers) {
			const g = this.game, i = g.current, p = g.players[i], options = this.evolvable(i);
			if (p.bot || g.cards_played || !options.length) return;
			const jokerIndex = p.hand.findIndex((c) => c.rank === "Joker");
			if (jokerIndex < 0) return;
			const option = options[this.ask("Choose an ability to evolve", options.map((t) => `${t.ability} → ${t.evolution.ability}`), answers)];
			p.hand.splice(jokerIndex, 1);
			p.ability_states[option.ability].evolved = true;
			this.notice = `${this.you(i)} evolved ${option.ability} into ${option.evolution.ability} and ended their turn.`;
			this.finishTurn();
		}
		cleave(action, answers) {
			const g = this.game, i = g.current, p = g.players[i], pileIndex = action.pile;
			if (![0, 1].includes(pileIndex) || !(g.effective(i, "Cleave") || p.god_rule === "Top card discard")) return;
			const ability = g.effective(i, "Cleave") || (p.god_rule === "Top card discard" ? "Cleave" : null);
			if (!ability) return;
			const uses = p.ability_states.Cleave || { round: -1, uses: 0 };
			if (uses.round === g.round && (ability === "Spider Net Cleave" ? uses.uses >= 5 : uses.uses >= 1)) return;
			if (!g.discards[pileIndex].length) return;
			let replacements = null;
			const available = ["hand", "face_up", "face_down"].flatMap((zone) => p[zone].map((c, index) => ({ zone, index, c })));
			if (ability === "Spider Net Cleave" && g.discards[pileIndex].length === 1 && available.length >= 2) {
				const picked = [];
				for (let n = 0; n < 2; n++) {
					const options = available.filter((row) => !picked.includes(row));
					const choice = options[this.ask(`Spider Net Cleave: choose a card for discard pile ${n + 1}`, options.map((row) => `${row.zone.replace("_", " ")}: ${row.zone === "face_down" ? "Face-Down card" : cardText(row.c)}`), answers)];
					const jokerValue = choice.c.rank === "Joker" ? this.ask(`Joker value for discard pile ${n + 1}`, RANKS, answers) + 2 : null;
					picked.push(choice);
					choice.jokerValue = jokerValue;
				}
				replacements = picked;
			}
			const removed = g.discards[pileIndex].pop();
			g.destroyed.push(removed);
			g.pile_value_history[pileIndex].pop();
			g.pile_owner_history[pileIndex].pop();
			g.pile_values[pileIndex] = g.pile_value_history[pileIndex].at(-1) ?? 14;
			g.pile_last_player[pileIndex] = g.pile_owner_history[pileIndex].at(-1) ?? null;
			if (replacements) {
				const other = 1 - pileIndex;
				g.destroyed.push(...g.discards[other].splice(0));
				g.pile_values[other] = 14; g.pile_last_player[other] = null;
				g.pile_value_history[other] = []; g.pile_owner_history[other] = [];
				for (const row of replacements) {
					const zone = p[row.zone], index = zone.indexOf(row.c);
					if (index >= 0) zone.splice(index, 1);
				}
				for (let n = 0; n < 2; n++) {
					const row = replacements[n], targetPile = n === 0 ? pileIndex : other;
					g.discards[targetPile].push(row.c);
					g.pile_values[targetPile] = rankValue(row.c, row.jokerValue);
					g.pile_last_player[targetPile] = i;
					g.pile_value_history[targetPile] = [g.pile_values[targetPile]];
					g.pile_owner_history[targetPile] = [i];
				}
			}
			uses.round = g.round; uses.uses++;
			if (!p.ability_states.Cleave) p.ability_states.Cleave = uses;
			if (p.god_rule === "Top card discard") p.god_rule = "";
			this.notice = replacements
				? `${ability} destroyed both piles and replaced them with two cards.`
				: `${ability} destroyed ${cardText(removed)}.`;
		}
		enchain(answers) {
			const g = this.game, users = this.humans().filter((i) => this.canEnchain(i));
			if (!users.length) return;
			const viewer = this.viewer();
			const user = users.includes(viewer) ? viewer : users.length === 1 ? users[0] : users[this.ask("Who is using Enchain?", users.map((i) => g.players[i].name), answers)];
			const targets = this.enchainTargets(user);
			if (!targets.length) return;
			const target = targets[this.ask(`${g.players[user].name}: choose a player to soul swap with. You must then play 2 cards`, targets.map((i) => g.players[i].name), answers)];
			const a = g.players[user], b = g.players[target];
			[a.hand, b.hand] = [b.hand, a.hand]; [a.face_up, b.face_up] = [b.face_up, a.face_up]; [a.face_down, b.face_down] = [b.face_down, a.face_down];
			a.enchain_used = true;
			if (user !== g.current) {
				g.enchain_return = { current: g.current, cards_played: g.cards_played, turn_pile: g.turn_pile, human_has_played: g.human_has_played };
				g.current = user; g.cards_played = 0; g.turn_pile = null;
			}
			g.enchain_player = user; g.enchain_remaining = 2;
			this.lastHuman = user; g.human_has_played = false;
			this.notice = `${this.you(user)} soul swapped with ${g.players[target].name}. Play 2 cards in a row.`;
		}
		sixEyes(answers) {
			const g = this.game, i = g.current, p = g.players[i], ability = g.effective(i, "Six Eyes");
			if (p.bot || !ability || p.six_eyes_turn === g.turn) return;
			const choice = this.ask("Six Eyes", ["View one of your face-down cards", "See another player's hand"], answers);
			if (choice === 0 && p.face_down.length) {
				const cardIndex = this.ask("Choose a face-down card", p.face_down.map((_, n) => `Face-Down card ${n + 1}`), answers);
				g.remember(i, p.face_down[cardIndex], i);
				this.notice = `Six Eyes saw ${cardText(p.face_down[cardIndex])}.`;
			} else {
				const targets = g.players.map((entry, n) => n).filter((n) => n !== i && !g.players[n].is_eliminated);
				if (targets.length) {
					const target = targets[this.ask("Choose a player", targets.map((n) => g.players[n].name), answers)];
					for (const c of g.players[target].hand) g.remember(i, c, target);
					this.notice = `Six Eyes viewed ${g.players[target].name}'s hand.`;
				}
			}
			p.six_eyes_turn = g.turn;
		}
		fullHand() {
			const g = this.game, i = g.current, p = g.players[i];
			if (!g.hasRule(i, "Full Hand") || p.bot) return;
			p.hand.push(...p.face_up.splice(0), ...p.face_down.splice(0));
			if (p.god_rule === "Full Hand") p.god_rule = "";
			this.notice = `${this.you(i)} used Full Hand.`;
		}
		cardSwap(answers) {
			const g = this.game, i = g.current, p = g.players[i];
			if (!this.canCardSwap(i)) return;
			const { own, targets } = this.cardSwapChoices(i);
			const ownRow = own[this.ask("Choose a card to swap", own.map((row) => `${row.zone.replace("_", " ")}: ${cardText(row.card)}`), answers)];
			const targetRow = targets[this.ask("Choose a visible card", targets.map((row) => {
				const location = row.owner < 0
					? row.zone === "destroyed" ? "Destroyed pile" : `Discard pile ${row.pile + 1}`
					: `${g.players[row.owner].name} / ${row.zone.replace("_", " ")}`;
				return `${location}: ${cardText(row.card)}`;
			}), answers)];
			const ownCards = p[ownRow.zone];
			const targetCards = targetRow.owner < 0
				? targetRow.zone === "destroyed" ? g.destroyed : g.discards[targetRow.pile]
				: g.players[targetRow.owner][targetRow.zone];
			const old = ownCards[ownRow.index], other = targetCards[targetRow.index];
			ownCards[ownRow.index] = other;
			targetCards[targetRow.index] = old;
			if (targetRow.zone === "discard_pile" && old.rank !== "Joker") {
				g.pile_value_history[targetRow.pile][targetRow.index] = rankValue(old);
				if (targetRow.index === targetCards.length - 1) g.pile_values[targetRow.pile] = rankValue(old);
			}
			p.swap_round = g.round;
			if (g.effective(i, "Lapse Blue")) this.applyReveal(i);
			if (p.god_rule === "Card Swapping") p.god_rule = "";
			const location = targetRow.owner < 0 ? (targetRow.zone === "destroyed" ? "the destroyed pile" : `discard pile ${targetRow.pile + 1}`) : `${g.players[targetRow.owner].name}'s ${targetRow.zone.replace("_", " ")}`;
			this.notice = `${this.you(i)} swapped ${cardText(old)} with ${location} (${cardText(other)}).`;
		}
		applyReveal(source) {
			const g = this.game;
			g.pending_reveals = [];
			for (let i = 0; i < g.players.length; i++) {
				const target = g.players[i];
				if (i === source || target.is_eliminated || g.finished(i) || g.immune(i) || !target.hand.length || target.revealed_cards.length) continue;
				if (target.bot) target.revealed_cards.push(target.hand[Math.floor(Math.random() * target.hand.length)]);
				else g.pending_reveals.push(i);
			}
		}
		reveal(action) {
			const i = this.viewer(), p = this.game.players[i], index = Number(action.card);
			if (!this.game.pending_reveals.includes(i) || index < 0 || index >= p.hand.length) return;
			const c = p.hand[index]; p.revealed_cards.push(c); this.game.pending_reveals = this.game.pending_reveals.filter((n) => n !== i);
			this.notice = `${p.name} revealed ${cardText(c)}.`;
		}
		rescue(answers) {
			const g = this.game, i = g.current, p = g.players[i];
			if (!this.canRescue(i)) return;
			if (g.draw_piles.some((pile) => pile.length)) {
				for (let n = 0; n < 2; n++) {
					const available = g.draw_piles.map((pile, index) => pile.length ? index : -1).filter((index) => index >= 0);
					if (!available.length) break;
					p.hand.push(g.draw_piles[available[Math.floor(Math.random() * available.length)]].pop());
				}
			} else if (g.destroyed.length) {
				const choice = this.ask("Choose a card from the destroyed pile", g.destroyed.map(cardText), answers);
				p.hand.push(g.destroyed.splice(choice, 1)[0]);
			}
			p.rescue_round = g.round;
			if (p.god_rule === "Rescue Draw") p.god_rule = "";
			this.notice = `${this.you(i)} used Rescue Draw.`;
		}
		god(answers) {
			const g = this.game, i = g.current, p = g.players[i];
			if (!g.effective(i, "God of Jujutsu") || p.god_round === g.round || p.bot) return;
			const rule = RULE_NAMES[this.ask("Choose a rule for this round", RULE_NAMES, answers)];
			const grabValue = ["Quick Grab", "Card Swapping"].includes(rule)
				? this.ask(`Choose a value for ${rule}`, RANKS, answers) + 2
				: null;
			p.god_rule = rule; p.god_round = g.round;
			if (grabValue !== null) p.god_grab_value = grabValue;
			this.notice = `${this.you(i)} chose ${rule} for this round.`;
		}
		useGodRule(answers) {
			const g = this.game, i = g.current, p = g.players[i];
			if (p.bot) return;
			switch (p.god_rule) {
				case "Top card discard": {
					const piles = g.discards.map((pile, index) => pile.length ? index : -1).filter((index) => index >= 0);
					if (!piles.length) return;
					const pileIndex = piles[this.ask("Choose a discard pile", piles.map((index) => `Discard pile ${index + 1}`), answers)];
					const pile = g.discards[pileIndex], removed = pile.pop();
					g.destroyed.push(removed);
					g.pile_value_history[pileIndex].pop();
					g.pile_owner_history[pileIndex].pop();
					g.pile_values[pileIndex] = g.pile_value_history[pileIndex].at(-1) ?? 14;
					g.pile_last_player[pileIndex] = g.pile_owner_history[pileIndex].at(-1) ?? null;
					break;
				}
				case "Soul Swap": {
					const targets = g.players.map((_, index) => index).filter((index) => index !== i && !g.players[index].is_eliminated && !g.finished(index) && !g.immune(index) && !g.has(index, "God of Jujutsu"));
					if (!targets.length) return;
					const targetIndex = targets[this.ask("Choose a player to soul swap with", targets.map((index) => g.players[index].name), answers)];
					const target = g.players[targetIndex];
					[p.hand, target.hand] = [target.hand, p.hand]; [p.face_up, target.face_up] = [target.face_up, p.face_up]; [p.face_down, target.face_down] = [target.face_down, p.face_down];
					break;
				}
				case "Card Swapping": this.cardSwap(answers); break;
				case "Reveal": {
					const targets = g.players.map((_, index) => index).filter((index) => index !== i && !g.players[index].bot && g.players[index].god_rule !== "I-T");
					g.pending_reveals.push(...targets);
					break;
				}
				case "Rescue Draw": this.rescue(answers); break;
				case "Full Hand": this.fullHand(); break;
				default: return;
			}
			this.notice = `${this.you(i)} used God of Jujutsu: ${p.god_rule}.`;
			p.god_rule = "";
		}
		vow(answers) {
			const g = this.game, i = g.current, p = g.players[i];
			const cards = g.bindingVowCards(i);
			if (!g.effective(i, "Binding Vow") || p.vow_card || p.bot || g.cards_played || !cards.length) return;
			const cardIndex = this.ask("Choose a card to play as a King this turn", cards.map(cardText), answers);
			p.vow_card = cards[cardIndex];
			this.notice = `${this.you(i)} made a Binding Vow.`;
			this.finishTurn();
		}
		simpleDomain(answers) {
			const g = this.game, i = this.viewer(), p = g.players[i];
			if (!g.effective(i, "Simple Domain")) return;
			if (!p.simple_domain_used) {
				p.simple_domain_active = true;
				p.simple_domain_used = true;
				this.notice = `${this.you(i)} activated Simple Domain (refinement 3).`;
				return;
			}
			const effects = [];
			if (p.cut_meter > 0) effects.push("Cut Meter");
			if (p.revealed_cards.length) effects.push("Reveal");
			if (!p.simple_domain_active || p.cleanse_round === g.round || !p.hand.length || !effects.length) return;
			const effect = effects[this.ask("Choose a negative effect to remove", effects, answers)];
			const handIndex = this.ask("Choose a card from your hand to discard", p.hand.map(cardText), answers);
			const discarded = p.hand.splice(handIndex, 1)[0];
			g.destroyed.push(discarded);
			if (effect === "Cut Meter") p.cut_meter--;
			else p.revealed_cards = [];
			p.cleanse_round = g.round;
			this.notice = `${this.you(i)} discarded ${cardText(discarded)} with Simple Domain to remove ${effect}.`;
		}
		domain(answers) {
			const g = this.game, i = g.current, p = g.players[i];
			if (!g.domains.length) return;
			const domain = g.domains.find((d) => d.owner === i);
			const actions = ["Decrease a domain's refinement", "Draw to clash"];
			if (p.hand.some((c) => c.rank === "Joker")) actions.push("Use a Joker to strengthen or weaken a domain");
			const action = this.ask("Domain action", actions, answers);
			if (action === 0) {
				const target = g.domains[this.ask("Choose a domain", g.domains.map((d) => `${g.players[d.owner].name}: ${d.name} (${d.refinement})`), answers)];
				target.refinement--; if (target.refinement <= 0) g.domains = g.domains.filter((d) => d !== target);
			} else if (action === 1) {
				if (g.draw_piles.some((pile) => pile.length)) {
					const pile = g.draw_piles.find((entry) => entry.length);
					const drawn = pile.pop(); p.hand.push(drawn);
					if (["Jack", "Queen", "King"].includes(drawn.rank)) domain && (domain.shield = true);
					else if (drawn.rank === "Joker" && domain) domain.refinement++;
					else if (["2", "3", "4", "5"].includes(drawn.rank) && domain) domain.refinement--;
				}
			} else {
				const joker = p.hand.findIndex((c) => c.rank === "Joker");
				const target = g.domains[this.ask("Choose a domain", g.domains.map((d) => `${g.players[d.owner].name}: ${d.name} (${d.refinement})`), answers)];
				p.hand.splice(joker, 1); target.refinement--;
			}
			this.notice = `${this.you(i)} used a Domain action.`;
		}
		quickGrab(accept) {
			const g = this.game, viewer = this.viewer(), event = g.pending_quick_grabs[0];
			if (!event || !event.targets.includes(viewer) || g.immune(event.played_by)) return;
			this.resolveQuickGrab(viewer, accept);
			this.notice = accept ? `${this.you(viewer)} took the card with Quick Grab.` : `${this.you(viewer)} declined Quick Grab.`;
		}
		resolveQuickGrab(viewer, accept) {
			const g = this.game, event = g.pending_quick_grabs[0];
			if (!event || !event.targets.includes(viewer)) return;
			if (accept) {
				const pile = event.zone === "destroyed_pile" ? g.destroyed : g.discards[event.pile_index];
				const index = pile.indexOf(event.card);
				if (index >= 0) {
					const [taken] = pile.splice(index, 1);
					g.players[viewer].hand.push(taken);
					if (event.zone === "discard_pile") {
						g.pile_value_history[event.pile_index].splice(index, 1);
						g.pile_owner_history[event.pile_index].splice(index, 1);
						g.pile_values[event.pile_index] = g.pile_value_history[event.pile_index].at(-1) ?? 14;
						g.pile_last_player[event.pile_index] = g.pile_owner_history[event.pile_index].at(-1) ?? null;
					}
				}
				g.pending_quick_grabs.shift();
			} else {
				event.targets = event.targets.filter((i) => i !== viewer);
				if (!event.targets.length) g.pending_quick_grabs.shift();
			}
		}
		resolveSlash(answers) {
			const g = this.game, i = g.current, p = g.players[i];
			if (!p.pending_world_slashes) return;
			const zones = [];
			for (let owner = 0; owner < g.players.length; owner++) {
				const target = g.players[owner];
				if (target.is_eliminated || owner !== i && g.immune(owner)) continue;
				for (const zone of ["hand", "face_up", "face_down"]) if (target[zone].length) zones.push({ owner, zone, cards: target[zone] });
			}
			for (let pile = 0; pile < 2; pile++) if (g.discards[pile].length) zones.push({ zone: "discard_pile", pile, cards: g.discards[pile] });
			if (g.destroyed.length) zones.push({ zone: "destroyed_pile", cards: g.destroyed });
			for (let pile = 0; pile < 2; pile++) if (g.draw_piles[pile].length) zones.push({ zone: "draw_pile", pile, cards: g.draw_piles[pile] });
			if (!zones.length) { p.pending_world_slashes = 0; return; }
			const selected = zones[this.ask("World Cutting Slash: choose a card or pile to delete", zones.map((row) => {
				const label = row.zone === "discard_pile" ? `Discard pile ${row.pile + 1}` : row.zone === "destroyed_pile" ? "Destroyed pile" : row.zone === "draw_pile" ? `Draw pile ${row.pile + 1} (random)` : `${g.players[row.owner].name}'s ${row.zone.replace("_", " ")}`;
				return `${label} (${row.cards.length})`;
			}), answers)];
			let cardIndex = null;
			if (["hand", "face_up", "discard_pile", "destroyed_pile"].includes(selected.zone)) {
				cardIndex = this.ask("World Cutting Slash: choose the card to delete", selected.cards.map(cardText), answers);
			} else cardIndex = Math.floor(Math.random() * selected.cards.length);
			const targets = g.players.map((_, n) => n).filter((n) => n !== i && !g.finished(n) && !g.players[n].is_eliminated && !g.immune(n));
			const target = targets.length ? targets[this.ask("World Cutting Slash: choose a player to increase their Cut Meter", targets.map((n) => `${g.players[n].name} (Cut Meter ${g.players[n].cut_meter}/9)`), answers)] : null;
			const removed = selected.cards.splice(cardIndex, 1)[0];
			g.deleted.push(removed);
			if (selected.zone === "discard_pile") {
				g.pile_value_history[selected.pile].splice(cardIndex, 1);
				g.pile_owner_history[selected.pile].splice(cardIndex, 1);
				g.pile_values[selected.pile] = g.pile_value_history[selected.pile].at(-1) ?? 14;
				g.pile_last_player[selected.pile] = g.pile_owner_history[selected.pile].at(-1) ?? null;
			}
			if (target !== null) {
				const victim = g.players[target];
				victim.cut_meter++;
				if (victim.cut_meter >= 9) {
					victim.is_eliminated = true;
					g.deleted.push(...victim.hand, ...victim.face_up, ...victim.face_down);
					victim.hand = []; victim.face_up = []; victim.face_down = [];
				}
			}
			p.pending_world_slashes--;
			this.notice = target === null ? "World Cutting Slash deleted a card; no active opponent remains for Cut Meter." : `World Cutting Slash deleted ${selected.zone === "face_down" || selected.zone === "draw_pile" ? "a hidden card" : cardText(removed)}; ${g.players[target].name}'s Cut Meter is ${g.players[target].cut_meter}/9.`;
			g.checkWinner();
		}
		resolveLimitless(answers) {
			const g = this.game, i = g.current, p = g.players[i];
			if (!p.pending_limitless_effects.length) return;
			const effect = p.pending_limitless_effects[0];
			if (effect === "pick_one_face_down" && p.face_down.length) {
				const index = this.ask("Limitless Barrier: choose one face-down card to pick up", p.face_down.map((_, n) => `Face-Down card ${n + 1}`), answers);
				p.hand.push(p.face_down.splice(index, 1)[0]);
				this.notice = `Limitless Barrier picked up a face-down card.`;
			} else if (effect === "pick_all_face_down") {
				const count = p.face_down.length;
				p.hand.push(...p.face_down.splice(0));
				this.notice = `Limitless Barrier picked up ${count} face-down card(s).`;
			} else if (effect === "replace_hand_from_deleted" && p.hand.length && g.deleted.length) {
				const count = Math.min(p.hand.length, g.deleted.length), chosen = [];
				for (let n = 0; n < count; n++) {
					const available = g.deleted.map((_, index) => index).filter((index) => !chosen.includes(index));
					chosen.push(available[this.ask("Perfected Limitless: choose a Deleted card for your replacement hand", available.map((index) => cardText(g.deleted[index])), answers)]);
				}
				const replacement = chosen.map((index) => g.deleted[index]);
				g.destroyed.push(...p.hand); p.hand = [];
				for (const index of chosen.sort((a, b) => b - a)) g.deleted.splice(index, 1);
				p.hand.push(...replacement);
				this.notice = `Perfected Limitless replaced your hand with ${replacement.length} Deleted card(s).`;
			}
			p.pending_limitless_effects.shift();
			if (effect === "pick_one_face_down" && !p.face_down.length && p.hand.length === 0) this.notice = "Limitless Barrier resolved with no face-down cards.";
		}
	}

	const RULE_NAMES = ["Top card discard", "Soul Swap", "Stack destroy", "I-T", "Quick Grab", "Card Swapping", "Reveal", "Rescue Draw", "Full Hand"];

	const bridge = new Bridge();
	const adminZones = () => {
		const g = bridge.game, zones = [];
		for (const p of g.players) for (const zone of ["hand", "face_up", "face_down"]) zones.push([`${p.name} / ${zone.replace("_", " ")}`, p[zone], "player", null]);
		for (let i = 0; i < 2; i++) zones.push([`Draw pile ${i + 1}`, g.draw_piles[i], "draw_pile", i]);
		for (let i = 0; i < 2; i++) zones.push([`Discard pile ${i + 1}`, g.discards[i], "discard_pile", i]);
		zones.push(["Destroyed pile", g.destroyed, "destroyed_pile", null], ["Deleted pile", g.deleted, "deleted_pile", null]);
		return zones;
	};
	bridge.admin_status = () => JSON.stringify({ unlocked: bridge.admin, in_game: Boolean(bridge.game) });
	bridge.admin_unlock = (password) => {
		if (password === "ZaydIsABum") bridge.admin = true;
		return bridge.admin_status();
	};
	bridge.admin_cards = () => {
		if (!bridge.admin || !bridge.game) return JSON.stringify({ error: "Admin access is locked or no game is running." });
		let id = 0; const rows = [];
		for (const [location, cards] of adminZones()) for (const c of cards) rows.push({ id: id++, location, card: cardText(c), rank: c.rank, suit: c.suit });
		return JSON.stringify({ rows, ranks: [...RANKS, "Joker"], suits: SUITS });
	};
	bridge.admin_set = (rowId, rank, suit) => {
		if (!bridge.admin || !bridge.game) return JSON.stringify({ error: "Admin access is locked or no game is running." });
		if (![...RANKS, "Joker"].includes(rank)) return JSON.stringify({ error: "Choose a valid rank." });
		let offset = 0;
		for (const [location, cards, zone, pileIndex] of adminZones()) {
			if (rowId < offset + cards.length) {
				const index = rowId - offset, old = cards[index];
				cards[index] = card(rank, rank === "Joker" ? "" : (SUITS.includes(suit) ? suit : old.suit || SUITS[0]), rank === "Joker" ? 3 : old.deck_number);
				if (zone === "discard_pile") {
					const value = rank === "Joker" ? 14 : rankValue(cards[index]);
					bridge.game.pile_value_history[pileIndex][index] = value;
					if (index === cards.length - 1) bridge.game.pile_values[pileIndex] = value;
				}
				bridge.game.record(`Admin changed ${location} card value to ${cardText(cards[index])}.`);
				return JSON.stringify({ message: `Updated to ${cardText(cards[index])}.` });
			}
			offset += cards.length;
		}
		return JSON.stringify({ error: "That card no longer exists." });
	};
	bridge.bot_step = (count = 1) => {
		const g = bridge.game;
		for (let step = 0; g && step < Math.max(1, Number(count)); step++) {
			if (!bridge.setupComplete || g.winner !== null) break;
			if (g.pending_quick_grabs.length) {
				const event = g.pending_quick_grabs[0];
				if (event.targets.some((n) => !g.players[n].bot)) break;
				bridge.resolveQuickGrab(event.targets[0], true);
				continue;
			}
			const i = g.current, p = g.players[i];
			if (!p.bot) {
				if (g.finished(i)) { g.endTurn(); continue; }
				break;
			}
			if (p.pending_world_slashes) {
				bridge.resolveSlash({ values: Array(20).fill(0), pos: 0 });
				continue;
			}
			if (p.pending_limitless_effects.length) { bridge.resolveLimitless({ values: Array(20).fill(0), pos: 0 }); continue; }
			bridge.drawPref = null; g.refill(i);
			if (!g.cards_played) {
				const joker = p.hand.findIndex((c) => c.rank === "Joker"), track = bridge.evolvable(i)[0];
				if (joker >= 0 && track) {
					p.hand.splice(joker, 1); p.ability_states[track.ability].evolved = true;
					bridge.notice = `${p.name} evolved ${track.ability} into ${track.evolution.ability} and ended their turn.`;
					g.endTurn(); continue;
				}
				if (g.effective(i, "God of Jujutsu") === "God of Jujutsu" && p.god_round !== g.round) {
					const hasStack = p.hand.some((c) => [0, 1].some((pile) => g.discards[pile].length && g.pile_values[pile] === rankValue(c)));
					p.god_rule = hasStack ? "Stack destroy" : "I-T";
					p.god_round = g.round;
				}
				if (g.hasRule(i, "Full Hand") && (p.face_up.length || p.face_down.length) && p.hand.length < 3) {
					p.hand.push(...p.face_up.splice(0), ...p.face_down.splice(0));
				}
				if (g.effective(i, "Simple Domain") === "Simple Domain" && !p.simple_domain_used
					&& (p.cut_meter >= 3 || g.domains.some((domain) => domain.owner !== i))) {
					p.simple_domain_active = true; p.simple_domain_used = true;
				}
				if (bridge.canRescue(i) && p.hand.length < 2) bridge.rescue({ values: [], pos: 0 });
			}
			const [source, cards] = g.source(i);
			if (!source) { g.endTurn(); continue; }
			if (source === "face_down") {
				const ci = Math.floor(Math.random() * cards.length);
				const legal = [0, 1].filter((pile) => g.legal(cards[ci], pile, 14));
				const pile = legal[0] ?? 0;
				const [played, success] = g.playDown(i, ci, pile);
				bridge.notice = success ? `${p.name} revealed and played ${cardText(played)}.` : `${p.name} revealed ${cardText(played)} and picked up both piles.`;
				g.endTurn(); continue;
			}
			const options = [];
			for (let ci = 0; ci < cards.length; ci++) for (let pile = 0; pile < 2; pile++) {
				if (g.legal(cards[ci], pile, cards[ci].rank === "Joker" ? 14 : null)) options.push({ ci, pile });
			}
			if (!options.length) {
				const cleave = g.effective(i, "Cleave") || (p.god_rule === "Top card discard" ? "Cleave" : null);
				const usage = p.ability_states.Cleave || { round: -1, uses: 0 };
				if (cleave && (usage.round !== g.round || usage.uses < (cleave === "Spider Net Cleave" ? 5 : 1))) {
					const pile = g.discards.findIndex((entry) => entry.length);
					if (pile >= 0) {
						bridge.cleave({ pile }, { values: Array(20).fill(0), pos: 0 });
						bridge.notice = `${p.name} used Cleave on pile ${pile + 1} to open up a play.`;
						continue;
					}
				}
				if (!g.cards_played && g.effective(i, "Binding Vow") && !p.vow_card && g.pile_values.some((value) => value <= 13)) {
					p.vow_card = g.bindingVowCards(i)[0] || null;
					if (p.vow_card) { g.endTurn(); continue; }
				}
				if (!g.cards_played) g.takePiles(i);
				g.endTurn(); continue;
			}
			const rank = (c) => c.rank === "Joker" ? 15 : VALUES[c.rank];
			options.sort((a, b) => rank(cards[a.ci]) - rank(cards[b.ci]));
			const choice = options[0];
			const played = g.play(i, source, choice.ci, choice.pile, cards[choice.ci].rank === "Joker" ? 14 : null);
			bridge.notice = `${p.name} played ${cardText(played)}.`;
			g.human_has_played = true;
			const [, remainingCards] = g.source(i);
			const canContinue = remainingCards.some((c) => [0, 1].some((pile) => g.legal(c, pile, c.rank === "Joker" ? 14 : null)));
			if (g.winner === null && !p.pending_world_slashes && !p.pending_limitless_effects.length && !g.pending_quick_grabs.length && (!remainingCards.length || !canContinue || g.finished(i))) g.endTurn();
		}
		return bridge.get_state();
	};
	window.PalaceBridge = bridge;
})();
