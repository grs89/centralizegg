package container

import (
	"regexp"
)

// rxSafeResourceName limits resource names to alphanumeric, underscore, hyphen, and dot characters.
var rxSafeResourceName = regexp.MustCompile(`^[a-zA-Z0-9_.-]+$`)

// isValidResourceName validates that the input is a secure string that can be safely
// included in command line templates or remote SSH commands without risking command injection.
// It enforces that the string matches the safe regular expression and has a length between 1 and 253.
func isValidResourceName(s string) bool {
	if len(s) == 0 || len(s) > 253 {
		return false
	}
	return rxSafeResourceName.MatchString(s)
}
