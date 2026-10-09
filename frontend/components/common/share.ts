import { Platform, Share } from 'react-native';

/** Shares text on mobile; downloads it as a file in the browser. */
export async function shareText(filename: string, text: string, mimeType = 'text/csv'): Promise<void> {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const blob = new Blob([text], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        return;
    }
    await Share.share({ title: filename, message: text });
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
    const escape = (value: unknown) => {
        const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [columns.join(','), ...rows.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\n');
}
