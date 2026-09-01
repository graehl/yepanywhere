# Legacy frozen session shares keep plain Markdown

Frozen session revisions captured before safe transcript Markdown was added to
the public-share capture path store assistant text without its rendered HTML
augment. Because frozen payloads are immutable and streamed directly from the
stored revision, upgrading the server does not make media and file Markdown
links in those existing shares clickable. Live shares and newly captured
frozen shares receive the corrected projection.

Preserve snapshot immutability while making the hosted viewer render this
legacy representation safely. A compatibility path could locally render only
the missing assistant text with the same sanitizer contract, or create an
explicit replacement frozen revision without changing the old share. It must
not enable private project-path discovery, broaden the captured file manifest,
or reinterpret stored active HTML.

Found 2026-09-01 while repairing transcript-linked PNGs in a live public share.
