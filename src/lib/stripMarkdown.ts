/**
 * Strips markdown formatting from text, leaving plain text.
 * Used for note card previews and titles.
 */
export function stripMarkdown(text: string): string {
    let result = text;

    // Remove headings
    result = result.replace(/^#{1,6}\s+/gm, "");

    // Remove bold/italic
    result = result.replace(/\*{1,3}(.*?)\*{1,3}/g, "$1");
    result = result.replace(/_{1,3}(.*?)_{1,3}/g, "$1");

    // Remove strikethrough
    result = result.replace(/~~(.*?)~~/g, "$1");

    // Remove inline code
    result = result.replace(/`([^`]+)`/g, "$1");

    // Remove code blocks
    result = result.replace(/```[\s\S]*?```/g, "");

    // Remove images
    result = result.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");

    // Remove links, keep text
    result = result.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

    // Remove horizontal rules
    result = result.replace(/^[-*_]{3,}\s*$/gm, "");

    // Remove blockquotes
    result = result.replace(/^>\s+/gm, "");

    // Remove list markers
    result = result.replace(/^[\s]*[-*+]\s+/gm, "");
    result = result.replace(/^[\s]*\d+\.\s+/gm, "");

    // Remove HTML tags
    result = result.replace(/<[^>]+>/g, "");

    // Compress whitespace
    result = result.replace(/\n{3,}/g, "\n\n").trim();

    return result;
}
