/**
 * Define the type of edits used in Kenga views.
 */

export interface WinnieEdit {
    readonly label: string;
    undo(): void;
    redo(): void;
}
