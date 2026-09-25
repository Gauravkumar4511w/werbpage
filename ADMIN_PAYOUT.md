# Admin match payouts

The payout API stores users, match entries, confirmed results, and payout records in SQLite. It is intentionally server-authoritative: the browser must never decide or credit a winning balance.

## Local setup

1. Copy `.env.example` to `.env`.
2. Set a long private `ADMIN_PASSWORD` and `ADMIN_EMAIL`.
3. Start the API with `npm run api`.

Keep `data/` private and out of source control. The database is created at `DATABASE_DIR/arenacore.sqlite`.

## Admin flow

Login:

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:8787/api/admin/login -ContentType 'application/json' -Body (@{ email = $env:ADMIN_EMAIL; password = $env:ADMIN_PASSWORD } | ConvertTo-Json)
$token = $login.token
```

Register a two-team Clash Squad match. `userKeys` must be the backend account keys used by the user service (email or phone, normalized lowercase):

```powershell
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method Post -Uri http://localhost:8787/api/admin/matches/register -Headers $headers -ContentType 'application/json' -Body (@{
  matchId = 'match-2026-09-18-clash-squad-1v1'
  entryFee = 50
  teams = @(
    @{ teamKey = 'team-a'; userKeys = @('player-a@example.com') }
    @{ teamKey = 'team-b'; userKeys = @('player-b@example.com') }
  )
} | ConvertTo-Json -Depth 5)
```

Confirm the winner:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8787/api/admin/matches/confirm-result -Headers $headers -ContentType 'application/json' -Body (@{
  matchId = 'match-2026-09-18-clash-squad-1v1'
  winnerTeamKey = 'team-a'
} | ConvertTo-Json)
```

For two teams paying 50 each, the database records a 100-coin pool, 80 winning coins, and a 20-coin platform margin. A second confirmation for the same match returns the original payout and does not credit the winner again.

## Production note

The current Vite deployment config serves the frontend only. Do not use local SQLite on Vercel because its filesystem is ephemeral. Deploy the Node API on a persistent service and use a managed database or persistent volume, then set `DATABASE_DIR` there. The browser-side localStorage wallet is not a secure source of truth and must be replaced by authenticated user wallet API calls before real money is enabled.
