// Errors in the player's browser, sent to the game server's log (the user's screen froze after Play,
// and with nothing on the server there was nothing to go on). An error in a frame stops Phaser's loop
// for good, leaving its last frame on screen: what broke is only ever known from here.

const MAX_SENT = 20;     // a session's worth; the server logs no more than this either

/** Report this game's uncaught errors and rejections to the server (queued till it's connected). */
export function reportErrors(game) {
    let sent = 0;
    const send = (kind, err) => {
        if (++sent > MAX_SENT) return;
        const network = game.registry.get('networkManager');
        network?.report({
            kind,
            message: String(err?.message ?? err ?? ''),
            stack: String(err?.stack ?? ''),
            scenes: game.scene.getScenes(true).map(s => s.scene.key).join(','),
            ua: navigator.userAgent,
        });
    };
    window.addEventListener('error', e => send('error', e.error || e.message));
    window.addEventListener('unhandledrejection', e => send('rejection', e.reason));
}
