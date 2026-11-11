/**
 * Card text rendering. Card text is plain text with "\n" line breaks, "____"
 * blanks and <i>…</i> italics. Nothing else is interpreted, and everything is
 * rendered as text nodes, so imported decks can't inject markup.
 */

/** Splits text into [{ k: 'text', s, i }, { k: 'br' }, { k: 'blank' }]. */
export function tokenize(text, blanks = true) {
  const out = [];
  let italic = false;
  for (const part of String(text).split(/(<i>|<\/i>|\n|_{3,})/)) {
    if (!part) continue;
    if (part === '<i>') italic = true;
    else if (part === '</i>') italic = false;
    else if (part === '\n') out.push({ k: 'br' });
    else if (/^_{3,}$/.test(part)) out.push(blanks ? { k: 'blank' } : { k: 'text', s: part, i: italic });
    else out.push({ k: 'text', s: part, i: italic });
  }
  return out;
}

function Inline({ tokens }) {
  return tokens.map((t, n) => (t.k === 'br' ? <br key={n} /> : t.k === 'text' ? (t.i ? <i key={n}>{t.s}</i> : t.s) : null));
}

/** Plain card text (white cards, or a black card with empty blanks). */
export function CardText({ text }) {
  return tokenize(text).map((t, n) => (t.k === 'br' ? <br key={n} /> : t.k === 'blank' ? <span key={n} class="ci-blank" /> : t.i ? <i key={n}>{t.s}</i> : t.s));
}

/** Drops a white card's final full stop so it reads naturally inside a sentence. */
function trimAnswer(s) {
  return String(s).replace(/\.(<\/i>)?\s*$/, '$1');
}

/** A black card with the answers written into its blanks (extra answers go at the end). */
export function FilledBlack({ text, answers }) {
  const tokens = tokenize(text);
  const blanks = tokens.filter((t) => t.k === 'blank').length;
  let a = 0;
  const nodes = tokens.map((t, n) => {
    if (t.k === 'br') return <br key={n} />;
    if (t.k === 'text') return t.i ? <i key={n}>{t.s}</i> : t.s;
    const ans = answers[a++];
    return ans == null ? (
      <span key={n} class="ci-blank" />
    ) : (
      <mark key={n} class="ci-fill">
        <Inline tokens={tokenize(trimAnswer(ans), false)} />
      </mark>
    );
  });
  const extra = answers.slice(blanks);
  return (
    <>
      {nodes}
      {extra.map((ans, n) => (
        <span key={'x' + n} class="ci-extra">
          <mark class="ci-fill">
            <Inline tokens={tokenize(ans, false)} />
          </mark>
        </span>
      ))}
    </>
  );
}

/** Plain-text version (for aria labels). */
export function plain(text) {
  return String(text).replace(/<\/?i>/g, '').replace(/_{3,}/g, 'blank').replace(/\n/g, ' ');
}
