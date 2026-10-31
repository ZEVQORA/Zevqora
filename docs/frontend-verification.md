# Frontend verification — Flowing type

The latest revision is limited to the four method chapters. Account component hashes match the previous revision. The rest of this record retains the earlier account-page checks.

## Automated checks

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Repository ESLint check | Passed |
| Existing regression suite | 9 files / 45 tests passed |
| Release preflight | Passed |
| Static production build | Passed |

## Desktop browser checks

- The four method chapters render as real type, with no image or canvas nodes.
- Observe, Challenge, Verify and Release were selected. Their matching headings, terms and descriptions were checked. Every chapter retained the same computed background: `rgb(8, 10, 15)`.
- The headline is a continuous transformed reel. The four settled positions were checked at 0, approximately -300, -600 and -900 pixels in the desktop viewport. The active accessible heading matched the visible phrase.
- The new Sign in page rendered its cobalt type poster, open form layout, providers, labelled fields and primary action.
- Focusing the identifier input set the poster’s engaged state. The password visibility control changed the input type to text.
- The header account action navigated to Create account, which rendered its own typographic poster and full form.

## Mobile browser checks

In the 390px native iframe, the inner document measured 373px.

- Sign in had matching 373px client and scroll widths. It contained no decorative canvas. Password visibility changed correctly.
- Create account had matching 373px client and scroll widths. The heading measured 325px with matching scroll width; signup field pairs used a single 325px column.
- The confirmation password had its own reveal control.
- Method selection switched to Challenge and Release. All eight type lines measured 325px with matching scroll widths; the page had no horizontal overflow.
- The 122px headline window showed the correct reel positions at -122px and -366px. Both selected chapters retained the same Ink background.
- The method contained zero image/canvas nodes.

## Screenshots

The latest method capture is `docs/design/flowing-type.jpg`. The account captures remain `docs/design/type-sign-in.jpg` and `docs/design/type-create-account.jpg`. Older captures document earlier iterations.

## Verification limits

The static preview has no live authentication configuration. Provider and submit actions stay disabled, with a preview note. No real credentials were entered, no account was created, no terms were accepted and no OAuth, email or payment action was performed. Existing API and session logic remains in the source.

Reduced-motion handling is implemented; changing the OS preference was not exercised in this cloud browser. Production telemetry and model execution were not exercised.

The GitHub integration previously denied branch creation with HTTP 403. No GitHub merge or write is represented as completed. The source package and patch contain the full implementation against the original repository base.
