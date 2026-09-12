// casbin は内部の IP ユーティリティで Node の Buffer を参照する。
// main.tsx より前に読み込まれる独立したモジュールスクリプトとして実行し、
// casbin の初期化より先にグローバルを用意する。
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (typeof g.Buffer === 'undefined') {
  g.Buffer = Buffer;
}
