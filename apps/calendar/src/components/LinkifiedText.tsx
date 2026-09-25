import { Fragment } from "react";
import { linkify } from "../lib/linkify.js";

/** Plain text with its URLs, email addresses and phone numbers made tappable.
 *  Every href comes from `linkify`, which only ever builds `https?:`, `mailto:`
 *  and `tel:` ones — the text itself is never rendered as markup.
 *
 *  Not for the agenda rows: each is a `<button>`, and an anchor inside a button
 *  is invalid HTML that no browser handles the same way twice. Tapping the row
 *  opens the event's page, where the description is rendered with this. */
export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((run, i) =>
        run.kind === "text" ? (
          <Fragment key={i}>{run.text}</Fragment>
        ) : run.kind === "url" ? (
          <a key={i} href={run.href} target="_blank" rel="noopener noreferrer" className="sd-link">{run.text}</a>
        ) : (
          <a key={i} href={run.href} className="sd-link" style={{ whiteSpace: "nowrap" }}>{run.text}</a>
        ),
      )}
    </>
  );
}
