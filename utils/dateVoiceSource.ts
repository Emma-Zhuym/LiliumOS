// [EM-START: text-voice-favorites]
import type { DialogueItem } from '../types';

/** Resolve by batch position, so identical lines remain distinct favorites. */
export function resolveCurrentDateVoiceLine(parsed: DialogueItem[], batch: DialogueItem[], remainingCount: number, currentText: string): number | null {
    const currentIndex = batch.length - remainingCount - 1;
    if (currentIndex < 0 || batch[currentIndex]?.text !== currentText) return null;
    if (parsed.length !== batch.length || !parsed.every((line, index) => line.text === batch[index].text)) return null;
    return parsed[currentIndex]?.sourceLineIndex ?? null;
}
// [EM-END: text-voice-favorites]
