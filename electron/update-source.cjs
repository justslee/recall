// A source checkout is optional. Never reset, stash, run hooks or build code.
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const URL = "https://github.com/justslee/recall.git";
const safeConfig = [
  "core.hooksPath=/dev/null",
  "core.fsmonitor=false",
  "core.attributesFile=/dev/null",
  "credential.helper=",
  "submodule.recurse=false",
  "protocol.allow=never",
  "protocol.https.allow=always",
  "maintenance.auto=false",
  "gc.auto=0",
  "merge.verifySignatures=false",
  "commit.gpgSign=false",
];
function git(folder, args) {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/git",
      [...safeConfig.flatMap((v) => ["-c", v]), "-C", folder, ...args],
      {
        env: {
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          HOME: process.env.HOME,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
          GIT_ATTR_NOSYSTEM: "1",
        },
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error)
          return reject(
            Error(
              "The source update could not finish. Check the connection and repository in your assistant; your local work was not reset.",
            ),
          );

        resolve(stdout.trim());
      },
    );
  });
}
async function inspectSource(folder, run = git) {
  if (typeof folder !== "string" || !path.isAbsolute(folder))
    throw Error("Choose your Recall repository folder.");
  const real = fs.realpathSync(folder);
  // A normal clone only: no linked worktree or externally redirected Git directory.
  const directory = path.join(real, ".git");
  const entry = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!entry?.isDirectory() || entry.isSymbolicLink())
    throw Error("Choose a standalone Git clone of justslee/recall.");

  const configuration = await run(real, [
    "config",
    "--local",
    "--no-includes",
    "--list",
  ]);
  if (
    /^(?:include(?:if\.[^=]*)?\.path|filter\.|url\.|gpg\.|merge\.|diff\.(?:external|[^=]+\.command)|core\.(?:sshcommand|gitproxy|worktree)|remote\.[^.]+\.(?:uploadpack|receivepack|proxy)|extensions\.)/im.test(
      configuration,
    )
  )
    throw Error(
      "This repository has custom Git configuration. Update it with your assistant to preserve that setup.",
    );

  const origin = await run(real, [
    "config",
    "--local",
    "--no-includes",
    "--get",
    "remote.origin.url",
  ]);
  if (
    ![URL, URL.slice(0, -4), "git@github.com:justslee/recall.git"].includes(
      origin,
    )
  )
    throw Error("Choose a clone whose origin is justslee/recall.");

  if ((await run(real, ["rev-parse", "--show-toplevel"])) !== real)
    throw Error("Choose the root of the Recall repository.");

  if ((await run(real, ["symbolic-ref", "--short", "HEAD"])) !== "main")
    throw Error(
      "Your checkout is on a different branch. Update it with your assistant; Recall will not switch branches.",
    );

  if (await run(real, ["status", "--porcelain", "--untracked-files=normal"]))
    throw Error(
      "Your repository has local changes. Save or reconcile them with your assistant first; Recall will not discard them.",
    );

  for (const name of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "index.lock",
  ]) {
    if (fs.existsSync(path.join(directory, name)))
      throw Error(
        "Finish the existing Git operation before updating this repository.",
      );
  }
  return { folder: real, head: await run(real, ["rev-parse", "HEAD"]) };
}
async function updateSource(folder, run = git) {
  const before = await inspectSource(folder, run);
  // The fixed HTTPS endpoint bypasses custom SSH commands and credential prompts.
  await run(before.folder, [
    "fetch",
    "--no-tags",
    "--no-recurse-submodules",
    URL,
    "refs/heads/main",
  ]);
  const target = await run(before.folder, ["rev-parse", "FETCH_HEAD"]);
  if (!/^[a-f0-9]{40,64}$/.test(target))
    throw Error("The fetched source revision is invalid.");

  const current = await inspectSource(before.folder, run);
  if (current.head !== before.head)
    throw Error(
      "The checkout changed during download. Retry after the other Git operation finishes.",
    );
  if (target === before.head) return { status: "up_to_date", revision: target };
  if (
    (await run(before.folder, ["merge-base", before.head, target])) !==
    before.head
  )
    throw Error(
      "Your checkout contains local commits or has diverged. Recall preserved it; reconcile it with your assistant.",
    );

  await run(before.folder, [
    "merge",
    "--ff-only",
    "--no-edit",
    "--no-autostash",
    "--no-overwrite-ignore",
    target,
  ]);
  return { status: "updated", revision: target };
}
module.exports = { inspectSource, updateSource };
