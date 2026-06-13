# School Directory — Plan and Decision Log

A short orientation doc. Read this first, then the SRD, then the SDD.

## What this is

An identity-and-directory foundation for one school. Members share contact info selectively. Later services (Volunteering/Events, Interests matching) sit on top of this identity layer and are out of scope for now.

## Decisions locked

1. **User vs Person split.** Users are credentials; Persons are directory entities. A User controls many Persons.
2. **Shared control.** A Person may have multiple Controllers at once (two parents, one child). Adding a Controller is invite + accept; removing is guarded so the last Controller is not silently dropped. "Transfer" is add-then-remove.
3. **Students have no Users.** A student is a Person controlled by a parent. No student self-claim in v1.
4. **"Public" = visible to authenticated members of this service.** Nothing is ever exposed to the open internet.
5. **Neighbors discoverability is opt-in, independent of address visibility.** A private address is not surfaced as a Neighbor unless explicitly enabled. (Retained for your sign-off.) Approximate area is derived from lat/lon as a rounded distance.
6. **Geocoding via Nominatim on address mutation only.** Server-side; coordinates never sent to clients. Public-endpoint rules respected (descriptive user-agent, <=1 rps, attribution); bulk imports geocode in a deferred background queue.
7. **Email-only auth, no separate sign up / log in.** Magic links via Resend. One-year sessions. Registration globally toggleable. Admins invite past the toggle. Invites verify inbox ownership.
8. **Read-only offline.** Writes disabled (not queued) when the client detects it is offline.
9. **Offline cache holds everything the User can see**, treated as equivalent to a phone's contacts list — accepted risk, purged on signout, no client-side encryption in v1.
10. **No photo moderation.** Trust members; admins retain takedown.
11. **Stack:** Cloudflare Pages (React) + Workers (Hono) + D1 + R2, Resend for email, Nominatim for geocoding, GitHub Actions deploy on merge to `main`.

## Nothing left open

All earlier open questions are resolved. The only item still marked for your explicit sign-off is decision 5 (neighbor discoverability being opt-in for private addresses).

## Build order

M1 identity core -> M2 groups/households/classrooms/shares -> M3 neighbors/i18n/offline -> M4 bulk import/invitations/masquerade/admin.
