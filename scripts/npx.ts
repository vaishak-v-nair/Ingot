/**
 * How build scripts invoke npx, and why it looks like this.
 *
 * `shell: true` is REQUIRED here, not incidental. npx on Windows is `npx.cmd`, and since
 * the CVE-2024-27980 mitigation Node refuses to spawn a `.cmd` or `.bat` without a shell:
 * `execFileSync('npx.cmd', …)` fails with `spawnSync npx.cmd EINVAL`. Naming the file
 * directly and dropping the shell looks tidier and does not work — it was tried on
 * 2026-07-29 and broke both builds immediately. If you are here to remove `shell: true`,
 * this comment is the reason not to.
 *
 * `windowsHide` is the part that was actually worth adding. The shell gets a console
 * window when the parent is not already attached to one, which is a window flashing open
 * and shut on the user's desktop for every bundle. It costs nothing on other platforms.
 */
export const NPX_OPTS = { shell: true, windowsHide: true } as const;

/**
 * For spawning node directly, where no shell is involved and none is wanted. Keeps a child
 * process from being handed its own console window on Windows.
 */
export const QUIET = { windowsHide: true } as const;
