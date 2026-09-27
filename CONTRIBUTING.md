# Contributing

**A bug report with a reproduction is the contribution we can act on**, and we
do act on them.

The npm package is developed in a private working tree. It arrives here as
**one synthesised commit per release**, cut by a tool that copies an explicit
list of paths, and the commit carries an `Exported-From:` trailer naming the
revision it came from ([RELEASING.md](RELEASING.md)). A change made to
`packages/avatar/` here is not merged into anything: the next release
overwrites it and no test notices. So a fix to the package is a bug report,
and we make the change over there.

The package is a loader, and the avatar it loads is not in this repository. A
bug in how a character looks or moves is a bug report too.

## Licence

This repository is [MIT](LICENSE). By opening a pull request you confirm you
wrote the change, or are entitled to submit it, and that it may be released
under MIT.
