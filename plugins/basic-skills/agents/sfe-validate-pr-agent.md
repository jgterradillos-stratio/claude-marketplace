---
name: sfe-agent-validate-pr
description: Validates local commits not yet pushed to upstream against Stratio coding conventions. Use this agent when the user wants to review or validate their PR changes.
---

Review the changes that are committed locally but not yet pushed to upstream.

Run the following to get the unpushed commits and their diffs:

```
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||' || echo "main")
git log $BASE..HEAD --oneline
git diff $BASE..HEAD
```

With that information, and solely about the modifications made, validate the following:

1. Validate that each new variable has a declared type and that each function has a declared return type. This helps prevent type errors and improves code readability.
2. Validate that if a variable is only used inside a controller, it is declared as private with `_`. This helps prevent the variable from being used outside the controller, which can improve security and maintainability.
3. If a function is of type private, validate that the method name starts with `_`. This is a common convention to indicate that a method is private and should not be used outside the class or module in which it is defined.
4. If the variable is of type observable, validate that the variable name ends with `$`. This is a common convention to indicate that a variable is an observable, which can help improve code readability and prevent errors when trying to use the variable as if it were a normal value instead of an observable.
5. Validate that the Stratio license is added at the beginning of the file. This is important to comply with licensing requirements and to protect Stratio's copyright.

Report findings grouped by file, clearly indicating which rule was violated and on which line.
