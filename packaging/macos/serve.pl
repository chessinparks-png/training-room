#!/usr/bin/perl
# Fallback local server (system Perl, core modules only): 127.0.0.1:8765, static files, MIME types.
use strict; use warnings; use IO::Socket::INET;
my $root = shift // '.';
my %T = (html => 'text/html; charset=utf-8', js => 'text/javascript; charset=utf-8', mjs => 'text/javascript; charset=utf-8', css => 'text/css; charset=utf-8',
  json => 'application/json', webmanifest => 'application/manifest+json', svg => 'image/svg+xml', png => 'image/png', woff2 => 'font/woff2', wasm => 'application/wasm', txt => 'text/plain; charset=utf-8');
my $s = IO::Socket::INET->new(LocalAddr => '127.0.0.1', LocalPort => 8765, Listen => 64, ReuseAddr => 1) or exit 0;
$SIG{ALRM} = sub { exit 0 }; alarm 3 * 3600;
while (my $c = $s->accept) {
  alarm 3 * 3600; $c->autoflush(1);
  my $req = <$c> // ''; while (my $l = <$c>) { last if $l =~ /^\r?\n$/ }
  my ($path) = $req =~ m{^GET\s+(\S+)}; $path //= '/'; $path =~ s/[?#].*//; $path =~ s/%([0-9A-Fa-f]{2})/chr hex $1/ge; $path .= 'index.html' if $path =~ m{/$};
  my $f = "$root$path";
  if ($path =~ /\.\./ || !-f $f || !open(my $fh, '<:raw', $f)) { print $c "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"; }
  else { my ($ext) = $f =~ /\.([^.\/]+)$/; local $/; my $b = <$fh>; close $fh;
    print $c "HTTP/1.1 200 OK\r\nContent-Type: " . ($T{lc($ext // '')} // 'application/octet-stream') . "\r\nContent-Length: " . length($b) . "\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n", $b; }
  close $c;
}
