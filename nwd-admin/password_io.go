package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"golang.org/x/term"
)

// promptPassword reads a password from the terminal without echoing
// input. Falls back to a plain line read when stdin is not a terminal
// (e.g. when piped from another process). The Windows branch uses
// golang.org/x/term, which calls the platform console API directly.
func promptPassword(prompt string) (string, error) {
	fmt.Fprint(os.Stderr, prompt)
	fd := int(os.Stdin.Fd())
	if term.IsTerminal(fd) {
		pw, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return "", err
		}
		return string(pw), nil
	}
	// Non-tty fallback (e.g. piped from a script): read a line.
	reader := bufio.NewReader(os.Stdin)
	line, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}

// readPasswordStdin reads the password from stdin up to EOF. Used by
// the -stdin mode of gen-password, suitable for scripting and CI.
func readPasswordStdin() ([]byte, error) {
	return bufio.NewReader(os.Stdin).ReadBytes('\n')
}
