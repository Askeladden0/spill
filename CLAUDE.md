NEVER write play or game or something that makes the SEO look like it's a game website in HTML. If it's something that doesn't affect the SEO, ignore this.

Always merge after writing code

Never add category tags to games or ratings

Hver gang `supabase/schema.sql` oppdateres, skal Supabase-connectoren
brukes til å oppdatere SQL-en i det faktiske Supabase-prosjektet (f.eks.
`mcp__Supabase__apply_migration` eller `mcp__Supabase__execute_sql`), ikke
bare skrives til filen lokalt.

## Å gjøre en bruker til admin i Supabase

`profiles.is_admin` er beskyttet av triggeren `guard_profile_privileges`
(se `supabase/schema.sql`, seksjon 7). Kjører man en vanlig `update public.profiles
set is_admin = true where ...` i SQL Editor blir den stille reversert, fordi
`auth.uid()` er null der og triggeren da nullstiller `is_admin` tilbake til
gammel verdi (ingen feilmelding, bare ingen effekt).

Riktig fremgangsmåte: sett det midlertidige "trusted write"-flagget i SAMME
kjøring/transaksjon som update-en:

```sql
select set_config('studilla.trusted_profile_write', 'on', true);

update public.profiles
set is_admin = true
where lower(username) = lower('brukernavnet');
```

Etter at én bruker er admin, kan flere gjøres til admin direkte fra
adminpanelet (admin.html) i stedet for SQL.


