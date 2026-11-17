import { supabase } from './supabase-config.js';

// =========================================
// NUMBER BATTLE - ROOM + GAME ENGINE 6.2
// =========================================

const pages = document.querySelectorAll('.page');
let currentRoomId = null;
let currentRoomCode = null;
let currentChannel = null;
let currentPlayerId = null;
let currentPlayerName = 'Pemain';
let currentRoomSettings = null;
let mySecretSubmitted = false;
let currentSecretNumber = null;
let battleEntered = false;
let battleViewBusy = false;

function showPage(pageId) {
    pages.forEach(page => page.classList.remove('active'));
    const target = document.getElementById(pageId);
    if (!target) {
        console.error(`Page not found: ${pageId}`);
        return;
    }
    target.classList.add('active');
}

// =========================================
// NAVIGATION
// =========================================

document.getElementById('create-room-btn').addEventListener('click', () => showPage('create-page'));
document.getElementById('join-room-btn').addEventListener('click', () => showPage('join-page'));
document.getElementById('battle-home-btn').addEventListener('click', () => {
    removeCurrentChannel();
    currentRoomId = null;
    currentRoomCode = null;
    currentRoomSettings = null;
    currentSecretNumber = null;
    mySecretSubmitted = false;
    currentSecretNumber = null;
    battleEntered = false;
    showPage('home-page');
});
document.querySelectorAll('.back-btn').forEach(button => {
    button.addEventListener('click', () => showPage(button.dataset.back));
});

// =========================================
// AUTHENTICATION
// =========================================

async function initializePlayer() {
    try {
        let { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (!session) {
            const result = await supabase.auth.signInAnonymously();
            if (result.error) throw result.error;
            session = result.data.session;
        }

        currentPlayerId = session.user.id;
        console.log('Player authenticated:', currentPlayerId);
        return currentPlayerId;
    } catch (error) {
        console.error('Authentication error:', error);
        return null;
    }
}

const playerReady = initializePlayer();

// =========================================
// CREATE ROOM
// =========================================

document.getElementById('confirm-create-btn').addEventListener('click', async () => {
    const button = document.getElementById('confirm-create-btn');
    const playerName = document.getElementById('player-name').value.trim();
    const minNumber = Number(document.getElementById('min-number').value);
    const maxNumber = Number(document.getElementById('max-number').value);
    const maxAttempts = Number(document.getElementById('max-turns').value);

    if (!playerName) return alert('Masukkan nama kamu.');
    if (!Number.isSafeInteger(minNumber) || !Number.isSafeInteger(maxNumber) || minNumber >= maxNumber) {
        return alert('Masukkan rentang angka yang valid.');
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
        return alert('Jumlah kesempatan harus antara 1 sampai 20.');
    }

    button.disabled = true;
    button.textContent = 'Membuat ruang...';

    try {
        const userId = await playerReady;
        if (!userId) throw new Error('Autentikasi pemain gagal.');

        const { data, error } = await supabase.rpc('create_room', {
            p_player_name: playerName,
            p_min_number: minNumber,
            p_max_number: maxNumber,
            p_max_attempts: maxAttempts
        });
        if (error) throw error;

        await openLobby({
            roomId: data.room_id,
            roomCode: data.room_code,
            minNumber,
            maxNumber,
            maxAttempts
        });
        console.log('Room created:', data.room_code);
    } catch (error) {
        console.error('Create room error:', error);
        alert('Gagal membuat ruang: ' + error.message);
    } finally {
        button.disabled = false;
        button.textContent = 'Lanjutkan →';
    }
});

// =========================================
// JOIN ROOM
// =========================================

document.getElementById('confirm-join-btn').addEventListener('click', async () => {
    const button = document.getElementById('confirm-join-btn');
    const playerName = document.getElementById('join-name').value.trim();
    const roomCode = document.getElementById('room-code').value.trim().toUpperCase();

    if (!playerName || !roomCode) return alert('Masukkan nama dan kode ruang.');

    button.disabled = true;
    button.textContent = 'Bergabung ke ruang...';

    try {
        const userId = await playerReady;
        if (!userId) throw new Error('Autentikasi pemain gagal.');

        const { data, error } = await supabase.rpc('join_room', {
            p_room_code: roomCode,
            p_player_name: playerName
        });
        if (error) throw error;

        const { data: room, error: roomError } = await supabase
            .from('rooms')
            .select('id, room_code, min_number, max_number, max_attempts, status')
            .eq('id', data.room_id)
            .single();
        if (roomError) throw roomError;

        await openLobby({
            roomId: room.id,
            roomCode: room.room_code,
            minNumber: room.min_number,
            maxNumber: room.max_number,
            maxAttempts: room.max_attempts,
            status: room.status
        });
        console.log('Joined room:', room.room_code);
    } catch (error) {
        console.error('Join room error:', error);
        alert('Gagal bergabung ke ruang: ' + error.message);
    } finally {
        button.disabled = false;
        button.textContent = 'Gabung permainan →';
    }
});

// =========================================
// OPEN LOBBY + PLAYER LIST
// =========================================

async function openLobby(settings) {
    currentRoomId = settings.roomId;
    currentRoomCode = settings.roomCode;
    currentRoomSettings = settings;
    mySecretSubmitted = false;
    currentSecretNumber = null;
    battleEntered = false;

    document.getElementById('display-room-code').textContent = settings.roomCode;
    document.getElementById('display-range').textContent = `${settings.minNumber} – ${settings.maxNumber}`;
    document.getElementById('display-attempts').textContent = `${settings.maxAttempts} kali`;
    showPage('lobby-page');

    await loadRoomPlayers();
    const alreadyStarted = await refreshSetupStatus();
    if (!alreadyStarted) startRoomRealtime();
}

async function loadRoomPlayers() {
    if (!currentRoomId) return [];

    const { data, error } = await supabase
        .from('room_players')
        .select('user_id, player_name, seat')
        .eq('room_id', currentRoomId)
        .order('seat');

    if (error) {
        console.error('Load players error:', error);
        return [];
    }

    const me = data.find(player => player.user_id === currentPlayerId);
    if (me) currentPlayerName = me.player_name;

    const container = document.getElementById('players-list');
    container.replaceChildren();

    data.forEach(player => {
        const card = document.createElement('div');
        card.className = 'player-card';

        const details = document.createElement('div');
        details.className = 'player-details';
        const avatar = document.createElement('div');
        avatar.className = 'player-avatar';
        avatar.textContent = player.player_name.charAt(0).toUpperCase();

        const info = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = player.player_name;
        const role = document.createElement('small');
        role.textContent = player.seat === 1 ? 'PEMAIN 01 · PEMBUAT' : 'PEMAIN 02 · TAMU';
        info.append(name, role);
        details.append(avatar, info);

        const status = document.createElement('span');
        status.className = 'player-status';
        status.textContent = 'Terhubung';
        card.append(details, status);
        container.append(card);
    });

    document.getElementById('player-count').textContent = `${data.length} / 2`;
    const ready = data.length === 2;
    const startButton = document.getElementById('start-game-btn');
    document.getElementById('waiting-status').textContent = ready
        ? 'Kedua pemain sudah terhubung. Pilih angka rahasia kamu.'
        : 'Menunggu pemain lain bergabung...';
    startButton.disabled = !ready;
    startButton.textContent = ready ? 'Pilih angka rahasia →' : 'Menunggu lawan';
    return data;
}

// =========================================
// ROOM REALTIME
// =========================================

function removeCurrentChannel() {
    if (currentChannel) {
        supabase.removeChannel(currentChannel);
        currentChannel = null;
    }
}

function startRoomRealtime() {
    removeCurrentChannel();
    currentChannel = supabase
        .channel('room-' + currentRoomId)
        .on('postgres_changes', {
            event: '*', schema: 'public', table: 'room_players',
            filter: `room_id=eq.${currentRoomId}`
        }, async () => {
            await loadRoomPlayers();
        })
        .on('postgres_changes', {
            event: 'UPDATE', schema: 'public', table: 'rooms',
            filter: `id=eq.${currentRoomId}`
        }, async payload => {
            console.log('Room status updated:', payload.new.status);
            const started = await refreshSetupStatus();
            if (!started && payload.new.status !== 'playing') await loadRoomPlayers();
        })
        // The game engine creates game_state when the SECOND secret is locked.
        // Listen to that event too: rooms.status is not the source of truth here.
        .on('postgres_changes', {
            event: '*', schema: 'public', table: 'game_state',
            filter: `room_id=eq.${currentRoomId}`
        }, async payload => {
            console.log('Game state initialized/updated:', payload.eventType);
            await refreshSetupStatus();
        })
        .subscribe(status => console.log('Room realtime:', status));
}

// =========================================
// COPY ROOM CODE
// =========================================

document.getElementById('copy-room-code').addEventListener('click', async () => {
    const code = document.getElementById('display-room-code').textContent;
    try {
        await navigator.clipboard.writeText(code);
        const button = document.getElementById('copy-room-code');
        button.textContent = 'Tersalin!';
        setTimeout(() => button.textContent = 'Salin', 1500);
    } catch (error) {
        alert('Kode ruang tidak dapat disalin.');
    }
});

// =========================================
// ENTER GAME SETUP
// =========================================

document.getElementById('start-game-btn').addEventListener('click', async () => {
    if (!currentRoomId || !currentRoomSettings) return;
    const players = await loadRoomPlayers();
    if (players.length !== 2) return alert('Kedua pemain harus bergabung sebelum mengatur permainan.');

    document.getElementById('setup-range').textContent =
        `${currentRoomSettings.minNumber} – ${currentRoomSettings.maxNumber}`;

    const input = document.getElementById('setup-secret-number');
    input.min = currentRoomSettings.minNumber;
    input.max = currentRoomSettings.maxNumber;
    input.value = '';
    input.disabled = false;

    const button = document.getElementById('submit-secret-btn');
    button.disabled = false;
    button.textContent = 'Kunci angka rahasia →';
    document.getElementById('setup-progress').textContent = 'Angka kamu belum dikirim.';
    document.getElementById('setup-note').textContent = 'Setelah dikirim, angka rahasia tidak dapat diubah.';

    showPage('game-setup-page');
    await refreshSetupStatus();
});

// =========================================
// SUBMIT SECRET NUMBER
// =========================================

document.getElementById('submit-secret-btn').addEventListener('click', async () => {
    const button = document.getElementById('submit-secret-btn');
    const input = document.getElementById('setup-secret-number');
    const secretNumber = Number(input.value);

    if (!currentRoomId || !currentRoomSettings) return alert('Informasi ruang tidak ditemukan. Silakan bergabung kembali.');
    if (input.value.trim() === '' || !Number.isSafeInteger(secretNumber) ||
        secretNumber < currentRoomSettings.minNumber || secretNumber > currentRoomSettings.maxNumber) {
        return alert(`Pilih bilangan bulat dari ${currentRoomSettings.minNumber} sampai ${currentRoomSettings.maxNumber}.`);
    }

    button.disabled = true;
    button.textContent = 'Mengunci angka...';
    try {
        const userId = await playerReady;
        if (!userId) throw new Error('Autentikasi pemain gagal.');

        const { data, error } = await supabase.rpc('submit_secret', {
            p_room_id: currentRoomId,
            p_secret_number: secretNumber
        });
        if (error) throw error;

        mySecretSubmitted = true;
        currentSecretNumber = secretNumber;
        input.disabled = true;
        button.textContent = 'Angka rahasia terkunci';
        document.getElementById('setup-progress').textContent = data.game_ready
            ? 'Kedua angka rahasia sudah terkunci. Membuka arena...'
            : 'Angka rahasia kamu sudah terkunci. Menunggu lawan...';
        document.getElementById('setup-note').textContent = 'Angka rahasia kamu tersimpan secara pribadi dan tidak dapat diubah.';

        if (data.game_ready) await enterBattleArena();
    } catch (error) {
        console.error('Submit secret error:', error);
        alert('Gagal mengunci angka rahasia: ' + error.message);
        button.disabled = false;
        button.textContent = 'Kunci angka rahasia →';
    }
});

// =========================================
// SETUP STATUS - AUTO ENTER ARENA WHEN READY
// =========================================

async function refreshSetupStatus() {
    if (!currentRoomId) return false;
    try {
        const { data, error } = await supabase.rpc('get_game_setup_status', {
            p_room_id: currentRoomId
        });
        if (error) throw error;

        mySecretSubmitted = data.submitted;
        if (data.submitted && data.my_secret_number !== null && data.my_secret_number !== undefined) {
            currentSecretNumber = Number(data.my_secret_number);
        }
        const input = document.getElementById('setup-secret-number');
        const button = document.getElementById('submit-secret-btn');
        if (data.submitted && input && button) {
            input.disabled = true;
            button.disabled = true;
            button.textContent = 'Angka rahasia terkunci';
        }

        // Both submitted secrets are the authoritative setup-ready condition.
        // Do not depend on rooms.status being updated to 'playing'.
        if (data.ready_count === 2) {
            if (document.getElementById('setup-progress')) {
                document.getElementById('setup-progress').textContent = 'Kedua angka rahasia sudah terkunci. Membuka arena...';
            }
            await enterBattleArena();
            return true;
        }

        if (document.getElementById('setup-progress')) {
            document.getElementById('setup-progress').textContent = data.submitted
                ? 'Angka rahasia kamu sudah terkunci. Menunggu lawan...'
                : `${data.ready_count} dari 2 pemain sudah mengirim angka rahasia.`;
        }
        if (document.getElementById('setup-note')) {
            document.getElementById('setup-note').textContent = 'Setelah dikirim, angka rahasia tidak dapat diubah.';
        }
        return false;
    } catch (error) {
        // A room that has not reached secret setup yet has no setup state.
        console.log('Setup status:', error.message);
        return false;
    }
}

// =========================================
// BATTLE ARENA
// =========================================

async function enterBattleArena() {
    if (battleEntered) {
        await refreshBattleView();
        return;
    }
    battleEntered = true;
    removeCurrentChannel();
    document.getElementById('battle-room-code').textContent = `RUANG ${currentRoomCode || '------'}`;
    showPage('battle-page');
    await refreshBattleView();
    startBattleRealtime();
}

function startBattleRealtime() {
    removeCurrentChannel();
    currentChannel = supabase
        .channel('battle-' + currentRoomId)
        .on('postgres_changes', {
            event: '*', schema: 'public', table: 'game_state',
            filter: `room_id=eq.${currentRoomId}`
        }, async () => await refreshBattleView())
        .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'game_guesses',
            filter: `room_id=eq.${currentRoomId}`
        }, async () => await refreshBattleView())
        .subscribe(status => console.log('Battle realtime:', status));
}

async function refreshBattleView() {
    if (!currentRoomId || battleViewBusy) return;
    battleViewBusy = true;
    try {
        const { data, error } = await supabase.rpc('get_game_view', {
            p_room_id: currentRoomId
        });
        if (error) throw error;
        renderBattleView(data);
    } catch (error) {
        console.error('Battle view error:', error);
        document.getElementById('battle-status').textContent = 'Gagal memuat kondisi permainan. Silakan muat ulang halaman.';
    } finally {
        battleViewBusy = false;
    }
}

function renderBattleView(state) {
    const isMyTurn = state.phase === 'playing' && state.current_turn_user_id === state.my_user_id;
    const isFinal = state.phase === 'final_guess';
    const isFinished = state.phase === 'finished';

    document.getElementById('battle-round').textContent = isFinal ? 'TEBAKAN TERAKHIR' : `RONDE ${state.current_round}`;
    document.getElementById('my-player-name').textContent = currentPlayerName;
    document.getElementById('my-secret-number').textContent = currentSecretNumber ?? '—';
    document.getElementById('opponent-player-name').textContent = state.opponent_name || 'Lawan';
    document.getElementById('my-range').textContent = `${state.my_lower_bound} – ${state.my_upper_bound}`;
    document.getElementById('my-attempts').textContent = `${state.my_attempts_used} / ${state.attempt_limit}`;
    document.getElementById('opponent-attempts').textContent = `${state.opponent_attempts_used} / ${state.attempt_limit}`;

    const myIndicator = document.getElementById('my-turn-indicator');
    const opponentIndicator = document.getElementById('opponent-turn-indicator');
    myIndicator.textContent = isMyTurn ? 'GILIRAN KAMU' : (isFinal && !state.my_final_submitted ? 'TEBAKAN TERAKHIR' : 'MENUNGGU');
    myIndicator.classList.toggle('waiting', !isMyTurn && !(isFinal && !state.my_final_submitted));
    opponentIndicator.textContent = state.current_turn_user_id && state.current_turn_user_id !== state.my_user_id
        ? 'GILIRAN LAWAN'
        : (isFinal && !state.opponent_final_submitted ? 'TEBAKAN TERAKHIR' : 'MENUNGGU');
    opponentIndicator.classList.toggle('waiting', !(state.current_turn_user_id && state.current_turn_user_id !== state.my_user_id));

    const input = document.getElementById('battle-guess-input');
    const button = document.getElementById('submit-guess-btn');
    const label = document.getElementById('battle-guess-label');
    const mode = document.getElementById('guess-mode-label');
    const title = document.getElementById('guess-title');
    const description = document.getElementById('guess-description');

    input.min = state.my_lower_bound;
    input.max = state.my_upper_bound;

    if (isFinished) {
        input.disabled = true;
        button.disabled = true;
        document.getElementById('guess-panel').hidden = true;
        const resultBox = document.getElementById('battle-result');
        resultBox.hidden = false;
        let resultTitle = 'Hasil imbang!';
        let resultDescription = 'Kedua pemain menyelesaikan pertandingan dengan hasil yang sama.';
        if (state.winner_user_id === state.my_user_id) {
            resultTitle = 'Kamu menang!';
            resultDescription = 'Kamu berhasil menebak angka rahasia lawan lebih dulu.';
        } else if (state.winner_user_id) {
            resultTitle = `${state.opponent_name} menang.`;
            resultDescription = 'Lawan berhasil menebak angka rahasia kamu lebih dulu.';
        } else if (state.result === 'draw') {
            resultTitle = 'Hasil imbang!';
            resultTitle = 'Hasil imbang!';
            resultDescription = 'Babak tebakan terakhir berakhir imbang.';
        }
        document.getElementById('battle-result-title').textContent = resultTitle;
        document.getElementById('battle-result-description').textContent = resultDescription;
        document.getElementById('battle-status').textContent = 'Pertandingan selesai.';
    } else {
        document.getElementById('guess-panel').hidden = false;
        document.getElementById('battle-result').hidden = true;
        input.disabled = false;
        button.disabled = false;
        if (isFinal) {
            mode.textContent = 'TEBAKAN TERAKHIR';
            title.innerHTML = 'Satu angka<br>terakhir.';
            description.textContent = state.my_final_submitted
                ? 'Tebakan terakhir kamu sudah terkunci. Menunggu lawan.'
                : 'Kedua pemain mendapat satu kesempatan menebak terakhir. Hasil akan muncul setelah keduanya mengirim tebakan.';
            label.textContent = 'Tebakan terakhir kamu';
            button.textContent = state.my_final_submitted ? 'Tebakan terakhir terkunci' : 'Kirim tebakan terakhir →';
            input.disabled = state.my_final_submitted;
            button.disabled = state.my_final_submitted;
            document.getElementById('battle-status').textContent = state.my_final_submitted
                ? 'Tebakan terakhir sudah dikirim. Menunggu pemain lain.'
                : 'Kesempatan menebak biasa sudah habis. Kirim tebakan terakhir kamu.';
        } else {
            mode.textContent = 'SAATNYA MENEBak'.toUpperCase();
            title.innerHTML = 'Temukan<br>angkanya.';
            description.textContent = isMyTurn
                ? 'Rentang angka kamu berubah sesuai petunjuk dari lawan.'
                : 'Lawan sedang berpikir. Rentang angka kamu tetap tersimpan sendiri.';
            label.textContent = `Tebakan kamu (${state.my_lower_bound}–${state.my_upper_bound})`;
            button.textContent = 'Kirim tebakan →';
            input.disabled = !isMyTurn;
            button.disabled = !isMyTurn;
            document.getElementById('battle-status').textContent = isMyTurn
                ? 'Giliran kamu. Pilih angka dalam rentang yang tersedia.'
                : 'Menunggu langkah lawan...';
        }
    }

    const history = document.getElementById('battle-history');
    history.replaceChildren();
    document.getElementById('history-count').textContent = `${state.history.length} tebakan`;
    if (!state.history.length) {
        const empty = document.createElement('p');
        empty.className = 'history-empty';
        empty.textContent = 'Belum ada tebakan. Jadilah yang pertama.';
        history.append(empty);
    } else {
        state.history.forEach(item => {
            const row = document.createElement('div');
            row.className = 'history-item';
            const main = document.createElement('div');
            main.className = 'history-item-main';
            const who = document.createElement('strong');
            who.textContent = item.user_id === state.my_user_id ? 'Kamu' : item.player_name;
            const detail = document.createElement('small');
            detail.textContent = `Ronde ${item.round_number} · Tebakan ${item.guess_number}: ${item.guess_value}`;
            main.append(who, detail);
            const hint = document.createElement('span');
            hint.className = `history-hint ${item.hint}`;
            hint.textContent = item.hint === 'higher' ? 'LEBIH TINGGI' : item.hint === 'lower' ? 'LEBIH RENDAH' : 'TEPAT';
            row.append(main, hint);
            history.append(row);
        });
    }
}

// =========================================
// SUBMIT NORMAL / FINAL GUESS
// =========================================

document.getElementById('submit-guess-btn').addEventListener('click', async () => {
    const input = document.getElementById('battle-guess-input');
    const button = document.getElementById('submit-guess-btn');
    const guess = Number(input.value);
    const isFinal = document.getElementById('guess-mode-label').textContent === 'TEBAKAN TERAKHIR';

    if (input.value.trim() === '' || !Number.isSafeInteger(guess)) {
        return alert('Masukkan bilangan bulat yang valid.');
    }

    button.disabled = true;
    button.textContent = isFinal ? 'Mengirim tebakan terakhir...' : 'Mengirim tebakan...';
    try {
        const { data, error } = await supabase.rpc(
            isFinal ? 'submit_final_guess' : 'submit_guess',
            isFinal
                ? { p_room_id: currentRoomId, p_guess: guess }
                : { p_room_id: currentRoomId, p_guess: guess }
        );
        if (error) throw error;

        input.value = '';
        if (!isFinal && data.hint) {
            const feedback = data.hint === 'higher'
                ? 'Angka lawan LEBIH TINGGI dari tebakan kamu. Batas bawah rentangmu naik.'
                : data.hint === 'lower'
                    ? 'Angka lawan LEBIH RENDAH dari tebakan kamu. Batas atas rentangmu turun.'
                    : 'Tepat! Angka rahasia lawan berhasil ditemukan.';
            document.getElementById('guess-feedback').textContent = feedback;
        } else {
            document.getElementById('guess-feedback').textContent = data.both_submitted
                ? 'Kedua tebakan terakhir sudah dikirim. Menampilkan hasil...'
                : 'Tebakan terakhir kamu sudah terkunci. Menunggu lawan...';
        }
        await refreshBattleView();
    } catch (error) {
        console.error('Submit guess error:', error);
        alert('Gagal mengirim tebakan: ' + error.message);
        button.disabled = false;
    }
});

console.log('Number Battle Game Engine 6.2 initialized.');