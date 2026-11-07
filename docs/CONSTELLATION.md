# Constellation and expertise

Knowledge opens to Constellation. All domain roots stay on one canvas while selecting a topic expands its children in place. Open several branches to compare them and follow their connections; use **Collapse branch** or **Collapse all** to simplify the view. Pinch to zoom, drag to pan, or use the zoom and **Fit all** controls. Breadcrumbs preserve the selected path. Notes remains available beside Constellation; opening a linked note uses the normal reader and draft-preservation workflow.

The app loads expanded nodes and connections automatically through bounded requests, checking that the batches belong to the same graph revision. These are internal loading boundaries, not user-facing pages or a six-node display limit. At wide zoom levels, labels are selected for the viewport while the other node markers remain on the canvas. **Find on this canvas** searches the loaded, expanded graph and provides selectable results, including nodes whose labels are not currently shown. Expand a branch to include its children in that search. Keyboard zoom, pan and Fit controls supplement pointer gestures.

The graph uses local Knowledge notes, stable card/concept identities, and a versioned primary hierarchy. Explicit mappings take precedence over fallback placement. With a locked root policy, fallback can reuse an exact, unique normalized label or alias anywhere in the canonical hierarchy, including a nested branch. Ambiguous or unmatched topics remain reachable through **Unclassified**; they do not create another domain. Legacy profiles without a locked policy retain their existing topic-based fallback behavior. Fallback placement does not claim that the library has already been semantically classified. External citations do not automatically become concept relationships.

## Reading the graph

Color identifies a domain and remains consistent through its descendants. Computing uses blue, Mathematics & Statistics violet, and Economics & Finance teal; other profiles receive stable domain colors. A labeled legend and explicit other-domain badges distinguish context from the selected hierarchy. Hierarchy edges use their domain color, while connections across domains blend the two endpoints. Domain color does not imply expertise.

Internal particle density reflects the review-based expertise index. Hollow centers mean unassessed, while assessed nodes retain their evidence and needs-practice labels even when the index is very small. Positive values below 0.1 display as **<0.1**; genuine zero and unassessed remain distinct. The inspector exposes assessed objectives, coverage, confidence and counted reviews. Many unreviewed objectives can make a broad domain's index small even when a few specific topics have stronger evidence.

## Hierarchy authoring

The packaged `recall-taxonomy` skill maintains broader-to-specific parentage, aliases, relative branch weights, exact note/card/concept mappings, and typed cross-connections. The installed bridge supports `taxonomy list`, `taxonomy preview FILE`, `taxonomy apply FILE --apply`, and `taxonomy status REQUEST_ID`. A preview includes the expected revision; stale or ambiguous updates stop for reconciliation. An open Recall app applies queued requests through its existing writer.

A profile may store `rootPolicy: {mode: "locked", rootIds: [...]}` with its taxonomy. The resulting top-level node IDs must exactly match that approved set. Routine plans preserve the policy and can add or reorganize children. Changing the domain set requires an explicit policy change in an authorized organization plan; a locked profile never silently promotes imported tags into roots. The domain set belongs to the profile, rather than being hardcoded for every Recall user.

Administrative indexes and setup pages can map to the reserved note-only `library:guides` destination. **Library guides** appears as a separate navigation shelf, outside the domain hierarchy and expertise scoring. Unclassified is a separate holding area for subjects awaiting placement. Neither is an additional approved domain. Classification preserves source files and existing identities; it does not duplicate notes to make them appear in several regions.

There is one primary parent per hierarchy node. Connections such as `uses`, `prerequisite`, and `related` do not create additional parentage or scoring votes. Suggested connections retain that label and their provenance. Renames and moves retain node IDs. Authoring changes organization; it cannot edit expertise scores, rate cards, change schedules, grant execution trust, or rewrite source-note prose.

Use concept identity to group the same idea. A card's optional `objectiveId` distinguishes genuinely different assessment objectives within that concept and format. Rephrasings retain the same objective. Legacy cards without this field conservatively share one objective per concept and format. Existing card IDs and historical concept IDs are preserved; classification does not silently infer semantic identity from similar titles.

## Expertise model v1

The displayed number is a **provisional review-based expertise index**, not a validated psychometric measurement or a percentage of all possible knowledge. Its scope is the mapped, ready review objectives. Unassessed notes remain visible separately. Displayed coverage and confidence make the scope and evidential limits inspectable.

Only scored, non-practice `Again`, `Hard`, `Good`, and `Easy` reviews count in this version. Skips, undone reviews, future events, captured conversations, generated answers, and note imports contribute no scored evidence. Existing Atlas explanation, code-test, and handwriting evidence remains available there; it is not silently converted into independent ratings. Concepts, Math, and Coding have separate summaries, with an explicit Mixed view.

The projection retains full numerical precision through card and ancestor calculations; formatting happens at display time. A versioned precision upgrade recomputes derived scores from existing checkpoints in bounded batches, retaining pending corrections and avoiding a replay of historical reviews.

For each card, a compact checkpoint retains eligible review counts, effective spaced attempts, outcomes, current evidence-only memory state, content epoch, and time. At most one attempt per interval of at least 24 hours earns additional confidence; immediate repetition cannot multiply confidence. The latest eligible outcome still matters, including a same-day failure.

The transparent initial policy is:

- Confidence is `effectiveAttempts / (effectiveAttempts + 6)`.
- Retention readiness comes from the installed FSRS forgetting curve and the saved memory state.
- Durability is `min(1, log(1 + stabilityDays) / log(366))`.
- Successful-attempt quality uses credit 1 for Good/Easy, 0.35 for Hard, and 0 for Again across effective attempts.
- The current-outcome multiplier is 0.35 for Again, 0.7 for Hard, and 1 for Good/Easy.
- The authored assessment tier limits credit to 0.65 for Foundation, 0.85 for Application, and 1 for Advanced. This is declared assessment metadata, not independent proof that a problem tests transfer or synthesis.
- The card index is 100 times these factors. Display truncates to one decimal and remains below 100.

These constants are product policy, versioned explicitly, and need calibration against later independent assessments. Stronger claims about novel problem solving require validated assessments beyond this first review-based model.

Equivalent variants do not multiply expertise or coverage. Their latest eligible attempt represents their objective. Distinct objectives and applicable formats contribute separately. Within a hierarchy node, direct concepts form one averaged group; child branches contribute according to their explicit positive relative weights. A branch with many cards cannot overwhelm another branch merely through volume. Explicit empty branches remain unknown coverage in Mixed. Inapplicable formats contribute no practice requirement to a format-specific score.

Unreviewed objectives earn no demonstrated credit and remain **Unassessed**, rather than failed. Suspended ready cards retain their requirements and recorded evidence, so hiding a difficult card cannot raise coverage. Draft cards are not assessment requirements. Importing additional distinct requirements can lower coverage; that represents a wider assessed scope, not erased learning.

## Incremental checkpoints

SQLite mutation triggers mark affected card IDs dirty in the same transaction as card/review changes. A monotonic mutation sequence and durable dirty set capture inserts, undo, corrections, deletion, and edits; a highest-review-ID cursor alone would miss changes to existing events.

Normal review updates read only appended events for the affected card, update its compact summary, recompute its concept's distinct objectives, and propagate contribution differences up its primary ancestor path. Cached topic components avoid rescanning every card under that topic. Taxonomy changes rebuild memberships and topic rollups from concept checkpoints, without replaying review history. Initial migration and explicit model-version changes are bounded and resumable.

Time-dependent readiness refreshes in bounded batches, normally at most once per day per card, using compact memory state. The graph exposes pending work and evaluation times. Future-dated events are reconsidered only when their time arrives. Opening the graph neither creates review events nor changes schedules.

Meaningful prompt, answer, title, numeric-solution, or code changes create an evidence epoch. Older reviews remain intact but cannot certify the revised objective. Post-edit evidence memory is reconstructed from the new epoch, while the real FSRS schedule remains unchanged. Organization, permission metadata, and inline widget-only changes do not invalidate the objective. Undo or correction replays only the affected card when necessary.

Checkpoints are small derived rows in the existing local SQLite database. They do not create automatic full-profile backups. Content edits compare objective-bearing fields inside SQLite and retain only a per-card review cutoff, including an A-to-B-to-A change before the next refresh. Metadata and widget-only edits do not accumulate previous or replacement card bodies. Older transient content queues are compacted one row at a time on open. The trigger uses built-in SQLite operations, so ordinary SQLite writers require no application-defined function. Explicit portable backups omit the app's derived triggers; the writer recreates them on open. Unknown backup triggers remain rejected by restore validation.

## Validation boundaries

Regression coverage checks unknown versus weak evidence, format gaps, duplicate objectives, delayed attempts, undo and correction, content epochs, restart, bounded work, temporal decay, weighted topic propagation, and preservation of raw cards/reviews. Renderer acceptance uses disposable synthetic profiles with hidden windows. Passing these checks establishes implementation behavior, not scientific calibration of the expertise index or a new published release.

The current graph source passed all 413 Node regression tests with zero skips, including 71 focused taxonomy, expertise, graph and backup tests and eight graph-model tests. Both source and packaged production-renderer journeys passed with a synthetic 1,000-leaf branch, verifying complete expansion on one canvas without page controls, viewport-aware labels, searchable leaves, in-place collapse, connections and preserved learning data. The packaged Notes journey, CLI hierarchy-skill forward test and package privacy checks also passed; all renderer verification windows remained invisible and unfocused.

Signed local Mac build 15 was installed with the exact tested `app.asar`. An authorized complete taxonomy plan applied through the installed launcher with a revision receipt. Read-only enumeration through the installed graph accounted for the complete note/card inventory, exactly three approved domain roots under the locked policy, and a separate Library guides shelf. Expertise checkpoint work finished with no pending items. Before/after hashes confirmed unchanged raw cards, reviews, schedules, coding attempts, saved session, note files and drafts; no full-profile backup was created. This verifies the local installation. New notarization, public release and physical trackpad verification have not been completed.

The subsequent domain-color and precision update was installed as signed local build 16 with its exact tested archive. The precision-version upgrade finished with zero pending items, retained small positive contributions, and preserved genuine zero/unassessed semantics. Source notes, cards, reviews, schedules, attempts, session, drafts and taxonomy matched their pre-update hashes.

A local storage check edited a synthetic 1 MiB widget 64 times and its metadata another 64 times without opening the graph between edits. It retained one dirty card marker, zero copied content bodies, an unchanged expertise score, and zero backups; the checkpointed database remained 2,404,352 bytes. Mean write times were 14.0 ms for widget edits and 3.6 ms for metadata edits. A separate 32-edit, 1 MiB ordinary-prose batch averaged 4.7 ms per write. These are finite development-machine measurements, not device-wide latency guarantees.
