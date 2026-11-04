import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 명세 확정 */
export default class ConfirmClientScreen extends Screen {
  static override readonly id = "Confirm-Client";
  static override readonly title = "의뢰인 — 명세 확정";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"dateError": {"editor": "boolean", "default": false, "section": "상태"}, "profileMissing": {"editor": "boolean", "default": false, "section": "상태"}};


  renderVals(): Values {
    const dateErr = this.props.dateError ?? false;
    const prof = this.props.profileMissing ?? false;
    return {
      dateError: dateErr,
      dateOk: !dateErr,
      profileMissing: prof,
      blockedByDate: dateErr && !prof,
      canSubmit: !dateErr && !prof
    };
  }
}
