# Standout Moodboard

A shared, free-form canvas for the team's reference videos and designs. Drag things anywhere, zoom, resize, and everyone sees changes live.

**What it does:** upload images/videos (up to 50 MB each), paste YouTube/Vimeo/image links, add sticky notes, multiple boards, team login, live sync.

## One-time setup (about 10 minutes)

1. Create a free project at https://supabase.com.
2. **SQL Editor → New query**, paste all of `setup.sql`, Run.
3. **Project Settings → API**: copy the Project URL and the `anon` public key into `config.js`.
4. **Authentication → Providers → Email**: turn **off** "Confirm email" if you don't want to wait for emails (optional).
5. Add your team: **Authentication → Users → Add user** (email + password) for each person.
   Then turn **off** "Allow new users to sign up" (Authentication → Sign In / Providers) so strangers can't create accounts. Anyone who can log in can see and edit everything.

## Run it

Locally:

```bash
npx serve . -l 3002
```

Open http://localhost:3002.

For the team, deploy this `moodboard` folder as its own site (Vercel or Netlify, no build command, output directory `.`). Share the URL and the login.

## Controls

- Drag empty space to pan; scroll to pan; Ctrl/⌘ + scroll (or the +/− buttons) to zoom; click the % to fit everything.
- Drop files onto the canvas, or paste (Ctrl/⌘+V) an image, a file or a link.
- Drag an item to move it, drag the green dot to resize, `Delete` or × removes it.

## Limits to know

- Free Supabase: 1 GB file storage, 50 MB per file. For big videos, upload to YouTube (unlisted) or Drive and paste the link.
- Uploaded file URLs are public-but-unguessable. The board list and positions are login-only.

## Second setup step (features added later)

After `setup.sql`, also run `setup2.sql` once (profiles, comments, reactions, saved list, trash, tags). Safe to run twice.

## Feature map

- **Menu (☰):** Boards, Team dashboard, My saved list, Share new refs to WhatsApp, My profile, Members, Trash, Sign out.
- **Link button / Android share:** "Save to Moodboard" form with board, note, tags, status and a duplicate warning.
- **Open an item:** double-click a card (or tap in the feed) for the full-screen viewer with reactions, comments and replies.
- **Feed vs canvas:** phones open in the feed, desktops on the canvas. Toggle any time.
- **Tidy up:** sorts the board's cards into columns by type, with Undo for 15 seconds.
- **Forgot password:** in Supabase set Authentication → URL Configuration → Site URL to the deployed link.

## Files

`app.js` canvas core · `social.js` menu, profile, members, trash · `compose.js` save form · `data.js` reactions/comments/what's new · `viewer.js` item viewer · `feed.js` feed and mobile bar · `boards.js` boards manager and Tidy up · `insights.js` dashboard, saved list, WhatsApp text.
