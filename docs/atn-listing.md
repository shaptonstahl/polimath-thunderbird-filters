# addons.thunderbird.net listing

Source text for the ATN listing. Paste each section into the matching field of the
Developer Hub "Edit Listing" page. ATN's description field accepts a limited HTML subset
(`<b>`, `<i>`, `<a>`, `<ul>`, `<ol>`, `<li>`, `<code>`, `<blockquote>`), not Markdown, so
the description is given below in that form.

Screenshots live in `assets/screenshots/` and are regenerated with
`scripts/screenshot-harness/take-screenshots.sh`.

## Summary (250 characters max)

Replaces Thunderbird's filter editor with one that supports regular expressions, nested AND / OR / NOT logic, and Unicode lookalike (homoglyph) detection. Runs on new mail in folders you choose. Collects nothing.

## Description

```html
<b>Polimath Filters</b> is a more powerful filter editor for Thunderbird. Conditions can be any combination of AND, OR, and NOT groups, any condition can match a regular expression, and two operators catch phishing that uses lookalike Unicode characters (for example a Cyrillic "а" in "pаypal").

<b>Where to find it</b>
Polimath Filters has no toolbar button. Open its editor from <b>Tools → Add-ons and Themes</b> (Ctrl+Shift+A), then click the 🔧 <b>Add-on Options</b> button on the Polimath Filters card. The editor opens in a new tab.
Everything happens in that tab. Click <b>? Instructions</b> at any time for in-app help, and hover any <b>?</b> icon for help on that control.

<b>Getting started</b>
<ol>
<li><b>Choose folders to watch.</b> Click <b>Monitored folders…</b> and check the folders whose new mail should be filtered (usually each account's Inbox). Watch only the folders you need; every monitored folder adds work on new mail.</li>
<li><b>Create a filter.</b> Click <b>+ New Filter</b> and give it a name.</li>
<li><b>Pick its folders.</b> Under <b>Folders</b>, check which monitored folders this filter applies to.</li>
<li><b>Build the conditions.</b> The top group is AND or OR (click <b>Switch to OR/AND</b>). Use <b>+ Condition</b> to add a test and <b>+ Group</b> to nest another group. <b>Wrap in NOT</b> inverts a condition or group. Each condition is a field (Subject, From, From name, To, CC, BCC, Body, Has attachment, Sender in address book), an operator (contains, starts/ends with, matches regex, has confusable character, confusable with, …), and a value. The <b>Aa</b> button toggles case sensitivity.</li>
<li><b>Add actions.</b> Click <b>+ Add action</b>: mark read/unread, add/remove star, add/remove tag, or mark as spam.</li>
<li><b>Choose how the rule ends.</b> In <b>After this rule matches</b>, pick <i>Continue processing</i> (later filters still run), <i>Do not process with subsequent rules</i>, <i>Move to a folder</i>, or <i>Delete</i>.</li>
<li>Click <b>Save</b>.</li>
</ol>

<b>Managing filters</b>
<ul>
<li>Filters run top to bottom, and every matching filter applies. Drag the <b>⠿</b> handle to reorder.</li>
<li>The switch next to each filter enables or disables it. <b>×</b> deletes it.</li>
<li><b>▶</b> next to a filter runs just that filter on a folder you pick. <b>▶ Run all on folder…</b> runs every enabled filter. Both offer <b>Dry Run</b>, which lists the messages that would match without changing anything. Try a dry run before running a new filter for real.</li>
<li><b>Export…</b> and <b>Import…</b> save and load filters as JSON, for backup or to move them to another profile. Move-to-folder targets may need re-selecting after import on a different machine.</li>
</ul>

<b>Tips</b>
<ul>
<li>Regular expressions use JavaScript syntax. An invalid pattern is flagged before you can save.</li>
<li><b>has confusable character</b> (no value needed) matches text that mixes in lookalike characters. <b>confusable with</b> matches text that looks like your value, e.g. <code>paypal</code> also matches "pаypal" spelled with a Cyrillic "а".</li>
<li>Body, CC, and BCC conditions need the full message, so they are slower on large folders.</li>
</ul>

<b>Privacy</b>
Polimath Filters collects nothing: no accounts, no analytics, no network requests. Mail is read only inside Thunderbird on your computer, and filters are stored in Thunderbird's local extension storage.

Source code, issue tracker, and full documentation: <a href="https://github.com/shaptonstahl/polimath-thunderbird-filters">github.com/shaptonstahl/polimath-thunderbird-filters</a>
```

## Screenshots and captions

Upload in this order. The first one is the listing's lead image.

| File | Caption |
|---|---|
| `01-filter-list.png` | The filter list. Toggle, reorder, run, or delete filters; the buttons at the top open folder monitoring, import/export, and instructions. |
| `02-editor-regex-and-not.png` | A filter combining a regular expression with a NOT group, two actions, and a move-to-folder ending. |
| `03-editor-confusables.png` | Catching lookalike-character phishing: an OR group of "has confusable character" and "confusable with paypal". |
| `04-monitored-folders.png` | Choose which folders are watched for new mail. |
| `05-dry-run.png` | Dry run: preview which messages your filters would match before changing anything. |
| `06-instructions.png` | Built-in instructions, opened with the "? Instructions" button. |
