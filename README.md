# DeepSeek Saver

A small Firefox extension that saves your DeepSeek chat replies on your own computer, so you still have the full text even if the website deletes it from the screen.

## What it does

- Saves every reply from chat.deepseek.com as it arrives, together with your question.
- Groups messages by conversation.
- Lets you search, copy, and download replies as Markdown (`.md`).
- Marks replies that the site may have removed, so they are easy to find.

## How it works

The extension reads the reply directly from the network (`webRequest.filterResponseData`), before the page shows it. Whatever the site does afterwards, such as removing the text, does not change the copy already saved. It only appends text and ignores any command that tries to overwrite it.

## Install (temporary)

1. Unzip the folder.
2. In Firefox, open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and select `manifest.json`.
4. Open chat.deepseek.com and send a message.
5. Click the extension icon to see your saved replies.

Temporary add-ons are removed when Firefox closes, and the saved history may go with them. To keep it permanently, sign the add-on as "unlisted" on addons.mozilla.org, or use Firefox Developer Edition.

## Using it

| Button | What it does |
| --- | --- |
| Copy reply | Copies the DeepSeek answer |
| Copy all | Copies your question and the answer |
| Download .md | Saves the message as a Markdown file |
| Technical log | Copies debug info (useful for bug reports) |
| Delete | Removes one message (click twice to confirm) |
| Open in tab | Opens the list in a larger tab |
| Download all / Delete all | Works on the whole history |

The **Flagged** filter shows replies where the site may have removed the text. Use the search box to find any question or reply.

## Privacy

- Everything stays inside your Firefox profile (`browser.storage.local`).
- Nothing is sent anywhere. The extension has permission for chat.deepseek.com only and makes no outside requests.
- It keeps the last 300 replies and removes older ones automatically.
- It does not run in private windows unless you allow it in the add-on settings.

## Limitations

- If the server cuts the stream before sending the text, there is nothing to capture.
- If DeepSeek changes its stream format or API address, the extension may need an update.
- The "flagged" marker is a best guess based on the reply status.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension settings and permissions |
| `background.js` | Intercepts and stores replies |
| `parser.js` | Reads the DeepSeek stream format |
| `popup.html` / `popup.js` | The interface |
