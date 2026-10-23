NEVER write play or game or something that makes the SEO look like it's a game website in HTML. If it's something that doesn't affect the SEO, ignore this.

ALLTID merge til main og push etter kodeendringer, med mindre brukeren eksplisitt sier noe annet (f.eks. at hen vil teste lokalt først – da skal branchen IKKE merges eller pushes før brukeren ber om det).

Dette gjelder UMIDDELBART, i samme tur som endringen er ferdig – ikke spør, ikke vent på «merge it», ikke la arbeid ligge igjen på en feature-/worktree-branch. Rekkefølge: commit → merge til main (fra worktree: `git -C <hovedmappen> merge <branch>`) → `git push origin main`. Verifiser til slutt at `git status -sb` viser `main...origin/main` uten ahead/behind, og si kort at det er merget og pushet. Git-advarsler om at repoet er flyttet skal ignoreres.

Never add category tags to games or ratings

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
