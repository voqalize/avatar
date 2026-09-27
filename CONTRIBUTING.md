# Contributing

**A bug report with a reproduction is the contribution we can act on**, and we
do act on them. Pull requests are narrower than that, for the reasons below.

## `packages/avatar/` is exported

The npm package is developed in a private working tree. It arrives here as
**one synthesised commit per release**, cut by a tool that copies an explicit
list of paths, and the commit carries an `Exported-From:` trailer naming the
revision it came from ([RELEASING.md](RELEASING.md)). A change made to it here
is not merged into anything. The next release overwrites it, no test notices,
and the person who wrote it finds out months later. Refusing that change is
kinder than accepting it.

The package is a loader, and the avatar it loads is not in this repository. A
bug in how a character looks or moves is a bug report, not a pull request.

## `voqalize-avatar` is deprecated

`packages/avatar-py/` and `apps/server/` are developed here, but 0.4.1 is the
Python package's last release and neither tree takes new features. A fix that
matters to someone still on it is welcome while it is small.

```sh
cd packages/avatar-py
uv run pytest
```

## Scope is checked, not asked for

`.github/workflows/scope.yml` fails a pull request that changes anything outside
`packages/avatar-py/`, `apps/server/`, `.github/` and this file. It exists so the
first thing you learn about the boundary is a job in your own run, not a comment
three days later.

## Licence

Contributions are under [MIT](LICENSE), the licence on everything in this
repository. By opening a pull request you confirm you wrote the change, or are
entitled to submit it, and that it may be released under MIT.
