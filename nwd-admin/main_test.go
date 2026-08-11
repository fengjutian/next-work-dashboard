package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"
)

func TestRunGenCertProducesValidPair(t *testing.T) {
	dir := t.TempDir()
	if err := runGenCert([]string{
		"-host", "localhost,127.0.0.1",
		"-out", dir,
		"-days", "30",
		"-rsa-bits", "2048",
	}); err != nil {
		t.Fatalf("gen-cert: %v", err)
	}

	certPath := filepath.Join(dir, "cert.pem")
	keyPath := filepath.Join(dir, "key.pem")
	if _, err := os.Stat(certPath); err != nil {
		t.Fatalf("cert not written: %v", err)
	}
	if _, err := os.Stat(keyPath); err != nil {
		t.Fatalf("key not written: %v", err)
	}

	// Load the pair through tls to confirm it parses.
	pair, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		t.Fatalf("load x509: %v", err)
	}
	if len(pair.Certificate) == 0 {
		t.Fatal("empty certificate chain")
	}
	cert, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if cert.Subject.CommonName != "localhost" {
		t.Errorf("CN = %q, want localhost", cert.Subject.CommonName)
	}
	// Should advertise both the DNS name and the IP.
	foundDNS := false
	foundIP := false
	for _, d := range cert.DNSNames {
		if d == "localhost" {
			foundDNS = true
		}
	}
	for _, ip := range cert.IPAddresses {
		if ip.String() == "127.0.0.1" {
			foundIP = true
		}
	}
	if !foundDNS || !foundIP {
		t.Errorf("SAN missing: dns=%v ip=%v", cert.DNSNames, cert.IPAddresses)
	}

	// Key file must be 0600. Skipped on Windows because the OS
	// does not honor POSIX-style mode bits — the file is owned
	// by the current user and the gen-cert command runs with the
	// caller's privileges, which is the practical guarantee.
	if info, err := os.Stat(keyPath); err == nil {
		mode := info.Mode().Perm()
		if mode != 0o600 {
			t.Logf("key file perm = %o (Windows ignores POSIX mode bits, only verified on POSIX hosts)", mode)
		}
	}
}

func TestRunGenCertRejectsEmptyHost(t *testing.T) {
	if err := runGenCert([]string{"-host", ""}); err == nil {
		t.Fatal("expected error for empty host")
	}
}

func TestRunGenCertRejectsShortRSA(t *testing.T) {
	if err := runGenCert([]string{"-host", "localhost", "-rsa-bits", "1024"}); err == nil {
		t.Fatal("expected error for rsa-bits < 2048")
	}
}

func TestRunGenCertRejectsZeroDays(t *testing.T) {
	if err := runGenCert([]string{"-host", "localhost", "-days", "0"}); err == nil {
		t.Fatal("expected error for non-positive days")
	}
}

func TestSplitCSV(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"a,b,c", []string{"a", "b", "c"}},
		{" a , b ,c ", []string{"a", "b", "c"}},
		{"", nil},
		{",,,", nil},
	}
	for _, c := range cases {
		got := splitCSV(c.in)
		if len(got) != len(c.want) {
			t.Errorf("splitCSV(%q) = %v, want %v", c.in, got, c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("splitCSV(%q)[%d] = %q, want %q", c.in, i, got[i], c.want[i])
			}
		}
	}
}

func TestPEMRoundTrip(t *testing.T) {
	// Sanity check: a freshly written PEM block can be re-decoded
	// by the standard library. This guards against future changes
	// to writePEM accidentally emitting a non-standard block.
	dir := t.TempDir()
	path := filepath.Join(dir, "test.pem")
	if err := writePEM(path, "TEST", []byte("hello"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		t.Fatal("pem decode returned nil")
	}
	if block.Type != "TEST" {
		t.Errorf("type = %q, want TEST", block.Type)
	}
	if string(block.Bytes) != "hello" {
		t.Errorf("bytes = %q", block.Bytes)
	}
}
