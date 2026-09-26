// V14-②+ — safe math rendering for card faces (roadmap §2 KaTeX 体验增强).
//
// Convention: inline math is wrapped in $...$ in card content. Segments
// outside $..$ are HTML-escaped plain text; math segments render through
// KaTeX with throwOnError:false. The renderer NEVER passes raw content into
// HTML — card text is owner-reviewed content, but escaping stays structural.
//
// Cards without any $..$ render as a single escaped plain-text segment, i.e.
// byte-for-byte equivalent to the previous plain rendering.

import katex from 'katex';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderMathText(text: string): string {
  if (!text) return '';
  const parts = text.split(/(\$[^$]+\$)/);
  return parts
    .map((part) => {
      if (part.length > 2 && part.startsWith('$') && part.endsWith('$')) {
        try {
          return katex.renderToString(part.slice(1, -1), {
            throwOnError: false,
            output: 'html',
          });
        } catch {
          return escapeHtml(part);
        }
      }
      return escapeHtml(part);
    })
    .join('');
}
