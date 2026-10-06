# Apple Health import (iOS Shortcut)

Hydrox 45 fills your **Steps** goal (and an *Active energy* goal, if you have one) from Apple
Health. Nothing runs on the server side of Apple Health: an iOS Shortcut on your phone reads
today's totals and posts them to the app once a day. It takes about ten minutes to set up.

Replace `https://hydrox.yourdomain.com` below with the address you open the app from.

## 1. Get your import token

1. Open the app and go to its **Apple Health import** section (in the settings). Tap
   **Create token**.
2. Copy the token. It is shown **once**. Creating a new token revokes the previous one.

The token is a long random string like `k3Jd8f…`. It only lets its holder post step and energy
totals to your account; it cannot read anything or sign in to the app.

## 2. Build the Shortcut

Open the **Shortcuts** app on your iPhone, tap **+** to create a new shortcut and name it
"Hydrox Health". Add these actions in order:

1. **Find Health Samples**
   - Type: **Steps**
   - Filter: **Start Date** → **is today**
   - Sort by: none, Limit: off
   - Tap **Show More** and set **Group by** to **Day** (or leave grouping off and add
     **Calculate Statistics → Sum** right after). You want one number: the day's total.
   - Rename the output variable to `Steps` (tap the result → Rename).
2. **Find Health Samples**
   - Type: **Active Energy**
   - Filter: **Start Date** → **is today**
   - Same grouping / **Calculate Statistics → Sum** as above.
   - Rename the output to `ActiveKcal`.
3. **Dictionary** with two entries (both as **Text**, Shortcuts sends numbers as text and the
   server accepts that):

   | Key | Value |
   | --- | --- |
   | `steps` | the `Steps` variable |
   | `activeKcal` | the `ActiveKcal` variable |

4. **Get Contents of URL**
   - URL: `https://hydrox.yourdomain.com/api/import`
   - Tap **Show More**
   - Method: **POST**
   - Headers: add one header
     - Key: `Authorization`
     - Value: `Bearer <your token>` (the word `Bearer`, a space, then the token)
   - Request Body: **JSON**, and pick the **Dictionary** from step 3 as the body.

   What is sent over the wire:

   ```http
   POST /api/import HTTP/1.1
   Host: hydrox.yourdomain.com
   Authorization: Bearer k3Jd8f…
   Content-Type: application/json

   {"steps":"8421","activeKcal":"512.3"}
   ```

   The server answers `200` with what it stored and how many goals it filled:

   ```json
   { "date": "2026-10-10", "steps": 8421, "activeKcal": 512.3, "goalsUpdated": 1 }
   ```

5. (Optional) **Show Result** while you are testing, so you can see the server's answer.
   Remove it once the automation works, or the phone will show it every evening.

Notes on the body:

- `date` is optional and defaults to **today in Toronto**. To backfill a day, add
  `"date": "2026-10-09"`; it must be between the challenge start and today.
- Send `steps`, `activeKcal`, or both. Fields you leave out keep whatever was stored earlier.
- Posting again the same day simply overwrites: **last write wins**. Decimal step counts like
  `8421.0` are rounded.

## 3. Test it by hand

Tap **Run** (the ▶ button) on the shortcut. The first time, iOS asks for permission to read
Steps and Active Energy from Health; allow both. If you added **Show Result**, you see the JSON
above. Then open the app: today's card shows the Steps goal filled and a small "from Apple
Health" line with the imported steps and energy. The Apple Health import section in the app's
settings shows the time of the last import.

If it fails:

| Server answer | Meaning | Fix |
| --- | --- | --- |
| `401 bad_token` | The header is missing or the token is wrong or revoked | Check the header reads `Bearer <token>` with one space; create a new token and paste it again |
| `400 bad_request` | A value could not be read as a number, or nothing was sent | Make sure both dictionary values are the Health totals, not the sample lists |
| `400 future_date` / `before_start` | The `date` is outside the challenge | Remove the `date` key or fix it |

You can also try it from a computer:

```sh
curl -X POST https://hydrox.yourdomain.com/api/import \
  -H "Authorization: Bearer <your token>" \
  -H "Content-Type: application/json" \
  -d '{"steps":"8421","activeKcal":"512.3"}'
```

## 4. Make it run every evening

1. In Shortcuts, open the **Automation** tab and tap **+** (New Automation), then **Personal
   Automation** on older iOS versions.
2. Trigger: **Time of Day** → **8:30 PM**, repeat **Daily**.
3. Choose **Run Immediately** (not "Run After Confirmation") and turn **Notify When Run** off,
   so it never asks and never shows a banner.
4. Action: **Run Shortcut** → pick **Hydrox Health**.
5. Done.

Why 8:30 pm: the evening reminder goes out at 9 pm to anyone with nothing logged, and the
import counts as logging (and tells your partner you checked in, the first time each day). If
you walk after 8:30 the number is a little low; open the shortcut and tap **Run** again before
bed, or let it stand — the next day's post does not touch yesterday.

The automation only runs while the phone is unlocked or recently used; if an evening is missed,
run the shortcut by hand the next morning with `"date"` set to yesterday, or just let it go.

## 5. If the token leaks

Anyone with the token can post step totals to your account (nothing else). To cut them off:

1. In the app's Apple Health import section, tap **Create token** again. The old token stops
   working at once (`401 bad_token`).
2. Paste the new token into the shortcut's `Authorization` header.
3. Tap **Run** once to confirm the new token works.

**Revoke** removes the token without creating a new one; the automation then fails silently until
you create a token and update the shortcut. Tokens are never shown again after creation, so if you
lose it, rotate it.
