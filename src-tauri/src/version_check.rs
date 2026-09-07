use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteVersionInfo {
    pub version: String,
    pub title: Option<String>,
    pub notes: Option<Vec<String>>,
    pub url: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VersionCheckResponse {
    pub local_version: String,
    pub remote: Option<RemoteVersionInfo>,
    pub has_update: bool,
}

// 本仓库（fork 自 chen-zeong/DTV）的 GitHub Releases 最新正式版接口。
// 更新提示跟踪本 fork 自己 push 的 tag，而不是上游 chen-zeong 的发布。
// 「latest」只返回非 draft、非 prerelease 的版本，与 workflow 里
// tauri-action 用 releaseDraft:false / prerelease:false 发布的形态一致。
const RELEASES_API: &str = "https://api.github.com/repos/kongbaier/DTV/releases/latest";

/// GitHub Releases API 响应里我们用到的字段子集（其余字段忽略）。
#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
}

fn parse_semver_parts(v: &str) -> [i32; 3] {
    let cleaned = v.trim().trim_start_matches(['v', 'V']);
    let mut out = [0_i32; 3];
    for (idx, part) in cleaned.split('.').take(3).enumerate() {
        out[idx] = part.parse::<i32>().unwrap_or(0);
    }
    out
}

fn is_remote_newer(remote: &str, local: &str) -> bool {
    let r = parse_semver_parts(remote);
    let l = parse_semver_parts(local);
    r > l
}

#[tauri::command]
pub async fn check_version_cmd(
    app_handle: tauri::AppHandle,
    client: State<'_, reqwest::Client>,
) -> Result<VersionCheckResponse, String> {
    let local_version = app_handle.package_info().version.to_string();

    // 非关键功能：失败不重试、不报错，静默当作「没有远端版本信息」。
    let remote: Option<RemoteVersionInfo> = match client
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => match resp.json::<GithubRelease>().await {
            Ok(r) if !r.tag_name.trim().is_empty() => Some(RemoteVersionInfo {
                // tag 形如 v3.0.4，去掉前导 v；前端展示时自己会再补一个 v。
                version: r
                    .tag_name
                    .trim()
                    .trim_start_matches(['v', 'V'])
                    .to_string(),
                title: r.name.filter(|s| !s.trim().is_empty()),
                url: Some(r.html_url),
                notes: r.body.map(|b| {
                    b.lines()
                        .map(str::trim)
                        .filter(|l| !l.is_empty())
                        .map(str::to_string)
                        .collect()
                }),
                published_at: r.published_at.filter(|s| !s.trim().is_empty()),
            }),
            _ => None,
        },
        _ => None,
    };

    let has_update = remote
        .as_ref()
        .map(|r| is_remote_newer(&r.version, &local_version))
        .unwrap_or(false);

    Ok(VersionCheckResponse {
        local_version,
        remote,
        has_update,
    })
}
