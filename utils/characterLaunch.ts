export interface CharacterLaunchIntent {
    charId: string;
    openChibiStudio?: boolean;
    returnToChat?: boolean; // [EM: chat-avatar-settings]
}

let pending: CharacterLaunchIntent | null = null;

export const characterLaunch = {
    request(intent: CharacterLaunchIntent): void {
        pending = intent;
    },
    peek(): CharacterLaunchIntent | null {
        return pending;
    },
    consume(): CharacterLaunchIntent | null {
        const value = pending;
        pending = null;
        return value;
    },
};
