/**
 * update.js — 새 판 확인 · 받기 · 깔기
 * =========================================================================
 * 새 판이 나올 때마다 APK 를 손으로 보내고, 받는 쪽은 파일을 찾아 눌러야 했다.
 * 누가 아직 옛 판을 쓰는지도 알 수 없었다. 이제 앱이 스스로 확인한다.
 *
 * 구조는 두 겹이다.
 *
 *   version.json  주소가 앱 안에 박혀 있다. 내용만 고쳐 올리면 되므로
 *                 이 주소는 앱을 새로 깔지 않는 한 바뀔 일이 없다.
 *   APK           그 안에 적힌 주소에서 받는다. 판마다 새 파일을 올려도
 *                 version.json 만 고치면 되고, 드라이브가 아니어도 된다.
 *
 * 받는 일과 까는 일은 전부 네이티브(UpdaterPlugin)가 한다.
 * 드라이브는 CORS 를 안 열어 주고, 20MB 를 자바스크립트로 들고 있으면
 * 저사양 기기에서 터지기 때문이다.
 * =========================================================================
 */

/**
 * 새 판 정보가 놓인 자리.
 *
 * 구글 드라이브에 올린 뒤 '링크가 있는 모든 사용자' 로 공유하고, 링크에서
 * 파일 ID 만 뽑아 아래에 넣는다.
 *   공유 링크  https://drive.google.com/file/d/<여기가 ID>/view?usp=sharing
 *
 * 새 판을 낼 때는 **이 파일의 내용만 고쳐 덮어쓴다.** 드라이브에서 파일을
 * 지우고 새로 올리면 ID 가 바뀌어 옛 앱들이 길을 잃는다.
 */
const MANIFEST_ID = "1FedCHS5ySQyGRo8ryZiSYjyCM0FEklPi";

/**
 * 사용 메뉴얼이 놓인 자리.
 *
 * 앱 안에 박아 두지만, version.json 에 manual 을 적어 두면 그 쪽을 먼저
 * 쓴다. 메뉴얼을 다른 곳으로 옮겨도 앱을 새로 깔 필요가 없다.
 */
const MANUAL_URL = "";

let _manual = MANUAL_URL;

/**
 * 드라이브에 올린 메뉴얼 파일의 ID.
 *
 * version.json 에 manualId 를 적어 두면 앱이 그 파일을 받아다 제 안에서
 * 펼친다. 메뉴얼만 고쳐 덮어써도 앱을 새로 깔 필요가 없다.
 * (드라이브는 HTML 을 웹페이지로 보여 주지 못한다. 그래서 '링크를 연다'
 *  가 아니라 '받아다 편다'.)
 *
 * 앱 안에 박아 두므로 새 판 확인을 하지 않아도 바로 최신 메뉴얼이 열린다.
 * 메뉴얼을 다른 파일로 옮기면 version.json 의 manualId 가 이것을 덮는다.
 */
let _manualId = "1w9iaKcXNioSOiUrJq1PAUpeLxIYEHq2N";

/** 지금 쓸 메뉴얼 주소 (밖에서 여는 방식일 때만) */
export function manualUrl() { return _manual; }

/** 드라이브에 올려 둔 메뉴얼 파일 ID */
export function manualId() { return _manualId; }

/**
 * 드라이브에서 메뉴얼 본문을 받아 온다.
 *
 * 신호가 약한 곳에서 끝없이 기다리면 단추를 눌러 놓고 아무 일도 안 일어난
 * 것처럼 보인다. 오래 걸리면 포기하고 앱에 담긴 것을 편다.
 */
export async function fetchManual(id, timeoutMs = 9000) {
    const P = plugin();
    if (!P) throw new Error("이 화면에서는 받을 수 없습니다");
    const res = await Promise.race([
        P.fetchText({ url: driveUrl(id) }),
        new Promise((_, no) => setTimeout(
            () => no(new Error("시간이 너무 걸립니다")), timeoutMs)),
    ]);
    const body = (res && res.body) || "";
    if (body.length < 500 || body.indexOf("<") < 0) {
        throw new Error("메뉴얼을 읽지 못했습니다 — 공유 설정을 확인해 주세요");
    }
    return body;
}

/** 드라이브에서 파일을 내려받는 주소. confirm=t 는 큰 파일 안내 페이지를 건너뛴다. */
export function driveUrl(id) {
    return "https://drive.usercontent.google.com/download?id="
         + encodeURIComponent(id) + "&export=download&confirm=t";
}

function plugin() {
    const C = window.Capacitor;
    return (C && C.Plugins && C.Plugins.Updater) || null;
}

/** 이 기기에서 자동 업데이트를 쓸 수 있는지 (웹 미리보기에서는 못 쓴다) */
export function available() {
    return !!plugin() && !!MANIFEST_ID;
}

/** 아직 주소를 안 넣었는지 — 설정이 덜 된 것과 기능이 없는 것을 구분한다 */
export function configured() {
    return !!MANIFEST_ID;
}

/**
 * 새 판이 있는지 본다.
 *
 * @param {number} currentBuild 지금 깔린 판 번호
 * @returns {Promise<null|{build:number, name:string, notes:string, url:string,
 *                         sha256:string, size:number}>}
 *          새 판이 없으면 null. 확인에 실패하면 예외를 던진다.
 */
export async function check(currentBuild) {
    const P = plugin();
    if (!P) throw new Error("이 화면에서는 확인할 수 없습니다");
    if (!MANIFEST_ID) throw new Error("업데이트 주소가 아직 설정되지 않았습니다");

    const res = await P.fetchText({ url: driveUrl(MANIFEST_ID) });
    const body = (res && res.body) || "";

    let m;
    try {
        m = JSON.parse(body);
    } catch (e) {
        // 드라이브가 파일 대신 로그인·안내 페이지를 돌려준 경우가 대부분이다.
        throw new Error("새 버전 정보를 읽지 못했습니다 — 공유 설정을 확인해 주세요");
    }

    // 메뉴얼을 옮겼으면 새 자리를 받아 둔다 (버전이 같아도 반영한다)
    if (typeof m.manual === "string" && /^https?:\/\//.test(m.manual)) {
        _manual = m.manual;
    }
    if (typeof m.manualId === "string" && m.manualId) {
        _manualId = m.manualId;
    }

    const build = parseInt(m.build, 10);
    if (!isFinite(build)) throw new Error("새 버전 정보에 버전 번호가 없습니다");
    if (build <= currentBuild) return null;

    const url = m.url || (m.apkId ? driveUrl(m.apkId) : "");
    if (!url) throw new Error("새 버전 파일의 주소가 없습니다");

    return {
        build,
        name: m.versionName || ("Build " + build),
        notes: m.notes || "",
        url,
        sha256: m.sha256 || "",
        size: parseInt(m.size, 10) || 0,
    };
}

/** 받는 동안 진행률을 알려 준다. 돌려주는 함수를 부르면 그만 듣는다. */
export function onProgress(fn) {
    const P = plugin();
    if (!P || !P.addListener) return () => {};
    const h = P.addListener("progress", (e) => fn(e && e.percent ? e.percent : 0));
    return () => { try { h.remove ? h.remove() : (h.then && h.then((x) => x.remove())); } catch (e) {} };
}

/** 새 판을 받는다. 받은 파일이 적힌 확인값과 다르면 예외를 던진다. */
export async function download(info) {
    const P = plugin();
    if (!P) throw new Error("이 화면에서는 받을 수 없습니다");
    const res = await P.download({ url: info.url, sha256: info.sha256 || "" });
    return res.path;
}

/**
 * 안드로이드 설치 관리자를 부른다.
 *
 * 그 전에 '출처를 알 수 없는 앱 설치' 가 이 앱에 허용되어 있어야 한다.
 * 허용되어 있지 않으면 설정 화면을 열어 주고 false 를 돌려준다.
 */
export async function install(path) {
    const P = plugin();
    if (!P) throw new Error("이 화면에서는 설치할 수 없습니다");

    const can = await P.canInstall();
    if (!can || !can.allowed) {
        await P.openInstallSettings();
        return false;
    }
    await P.install({ path });
    return true;
}
