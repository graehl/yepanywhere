package device

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/kzahel/yepanywhere/device-bridge/internal/conn"
)

const (
	iosSimServerEnvVar      = "IOS_SIM_SERVER"
	iosSimDataDirEnvVar     = "YEP_ANYWHERE_DATA_DIR"
	defaultIOSSimServerName = "ios-sim-server"
)

// IOSSimulatorDevice communicates with ios-sim-server over a subprocess stdio transport.
type IOSSimulatorDevice struct {
	udid string

	readCloser  io.ReadCloser
	writeCloser io.WriteCloser
	reader      io.Reader
	writer      io.Writer
	closeFn     func() error

	width  int32
	height int32

	writeMu   sync.Mutex
	closeOnce sync.Once
	closeErr  error
}

// NewIOSSimulatorDevice starts ios-sim-server and initializes the framed connection.
func NewIOSSimulatorDevice(udid string) (*IOSSimulatorDevice, error) {
	udid = strings.TrimSpace(udid)
	if udid == "" {
		return nil, fmt.Errorf("ios simulator udid is required")
	}

	serverPath, err := resolveIOSSimServerPath()
	if err != nil {
		return nil, err
	}

	cmd := exec.CommandContext(context.Background(), serverPath, udid)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("ios-sim-server stdout pipe: %w", err)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("ios-sim-server stdin pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start ios-sim-server: %w", err)
	}

	closeFn := func() error {
		_ = stdin.Close()
		_ = stdout.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
		return nil
	}

	return NewIOSSimulatorDeviceWithTransport(udid, stdout, stdin, closeFn)
}

// NewIOSSimulatorDeviceWithTransport creates an IOSSimulatorDevice from an existing transport.
// Intended for tests and dependency injection.
func NewIOSSimulatorDeviceWithTransport(
	udid string,
	reader io.ReadCloser,
	writer io.WriteCloser,
	closeFn func() error,
) (*IOSSimulatorDevice, error) {
	udid = strings.TrimSpace(udid)
	if udid == "" {
		udid = "ios-simulator"
	}
	if closeFn == nil {
		closeFn = func() error { return nil }
	}

	d := &IOSSimulatorDevice{
		udid:        udid,
		readCloser:  reader,
		writeCloser: writer,
		reader:      reader,
		writer:      writer,
		closeFn:     closeFn,
	}
	if err := d.readHandshake(); err != nil {
		_ = d.Close()
		return nil, err
	}
	return d, nil
}

func resolveIOSSimServerPath() (string, error) {
	if envPath := strings.TrimSpace(os.Getenv(iosSimServerEnvVar)); envPath != "" {
		if _, err := os.Stat(envPath); err != nil {
			return "", fmt.Errorf("%s is set but file does not exist: %s", iosSimServerEnvVar, envPath)
		}
		return envPath, nil
	}

	var exePath string
	if exe, err := os.Executable(); err == nil {
		exePath = exe
	}
	var cwd string
	if dir, err := os.Getwd(); err == nil {
		cwd = dir
	}
	var home string
	if dir, err := os.UserHomeDir(); err == nil {
		home = dir
	}

	candidates := iosSimServerBinaryCandidates(strings.TrimSpace(os.Getenv(iosSimDataDirEnvVar)), exePath, cwd, home)
	for _, sourceDir := range iosSimServerSourceCandidates(exePath, cwd) {
		candidates = append(candidates, filepath.Join(sourceDir, ".build", "release", defaultIOSSimServerName))
	}

	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}

	if runtime.GOOS == "darwin" {
		if sourceDir := findIOSSimServerSourceDir(exePath, cwd); sourceDir != "" {
			log.Printf("[IOSSimulatorDevice] Building ios-sim-server in %s", sourceDir)
			cmd := exec.Command("swift", "build", "-c", "release")
			cmd.Dir = sourceDir
			if output, err := cmd.CombinedOutput(); err == nil {
				builtPath := filepath.Join(sourceDir, ".build", "release", defaultIOSSimServerName)
				if _, statErr := os.Stat(builtPath); statErr == nil {
					return builtPath, nil
				}
			} else {
				return "", fmt.Errorf("build ios sim server: %w (%s)", err, strings.TrimSpace(string(output)))
			}
		}
	}

	return "", fmt.Errorf("ios sim server not found; set %s or build packages/ios-sim-server/.build/release/%s", iosSimServerEnvVar, defaultIOSSimServerName)
}

func iosSimServerBinaryCandidates(dataDir, exePath, cwd, home string) []string {
	candidates := make([]string, 0, 8)
	if dataDir = strings.TrimSpace(dataDir); dataDir != "" {
		candidates = append(candidates, filepath.Join(dataDir, "bin", defaultIOSSimServerName))
	}
	if exePath != "" {
		exeDir := filepath.Dir(exePath)
		candidates = append(candidates,
			filepath.Join(exeDir, defaultIOSSimServerName),
		)
	}
	if cwd != "" {
		candidates = append(candidates, filepath.Join(cwd, ".build", "release", defaultIOSSimServerName))
	}
	if home != "" {
		candidates = append(candidates, filepath.Join(home, ".yep-anywhere", "bin", defaultIOSSimServerName))
	}
	return uniquePaths(candidates)
}

func findIOSSimServerSourceDir(exePath, cwd string) string {
	candidates := iosSimServerSourceCandidates(exePath, cwd)
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, err := os.Stat(filepath.Join(candidate, "Package.swift")); err == nil {
			return candidate
		}
	}
	return ""
}

func iosSimServerSourceCandidates(exePath, cwd string) []string {
	roots := make([]string, 0, 10)
	if exePath != "" {
		roots = append(roots, ancestorDirs(filepath.Dir(exePath), 5)...)
	}
	if cwd != "" {
		roots = append(roots, ancestorDirs(cwd, 5)...)
	}

	candidates := make([]string, 0, len(roots)*2)
	for _, root := range uniquePaths(roots) {
		candidates = append(candidates,
			filepath.Join(root, "packages", "ios-sim-server"),
			filepath.Join(root, "ios-sim-server"),
		)
	}
	return uniquePaths(candidates)
}

func ancestorDirs(dir string, maxDepth int) []string {
	if dir == "" || maxDepth <= 0 {
		return nil
	}
	ancestors := make([]string, 0, maxDepth)
	current := filepath.Clean(dir)
	for range maxDepth {
		ancestors = append(ancestors, current)
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return ancestors
}

func uniquePaths(paths []string) []string {
	seen := make(map[string]struct{}, len(paths))
	unique := make([]string, 0, len(paths))
	for _, p := range paths {
		if p == "" {
			continue
		}
		clean := filepath.Clean(p)
		if _, ok := seen[clean]; ok {
			continue
		}
		seen[clean] = struct{}{}
		unique = append(unique, clean)
	}
	return unique
}

func (d *IOSSimulatorDevice) readHandshake() error {
	width, height, err := readHandshakeDimensions(d.reader)
	if err != nil {
		return fmt.Errorf("read handshake: %w", err)
	}
	d.width = width
	d.height = height
	return nil
}

// GetFrame requests one JPEG frame and decodes it into RGB888.
func (d *IOSSimulatorDevice) GetFrame(ctx context.Context, maxWidth int) (*Frame, error) {
	_ = ctx
	_ = maxWidth

	d.writeMu.Lock()
	err := conn.WriteFrameRequest(d.writer)
	d.writeMu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("write frame request: %w", err)
	}

	msgType, payload, err := conn.ReadMessage(d.reader)
	if err != nil {
		return nil, fmt.Errorf("read frame response: %w", err)
	}
	if msgType != conn.TypeFrameResponse {
		return nil, fmt.Errorf("unexpected message type: 0x%02x", msgType)
	}

	rgb, width, height, err := decodeJPEGToRGB(payload)
	if err != nil {
		return nil, err
	}
	d.width = int32(width)
	d.height = int32(height)

	return &Frame{
		Data:   rgb,
		Width:  int32(width),
		Height: int32(height),
	}, nil
}

// SendTouch forwards touch control to ios-sim-server.
func (d *IOSSimulatorDevice) SendTouch(ctx context.Context, touches []TouchPoint) error {
	_ = ctx
	payload, err := json.Marshal(struct {
		Cmd     string       `json:"cmd"`
		Touches []TouchPoint `json:"touches"`
	}{
		Cmd:     "touch",
		Touches: touches,
	})
	if err != nil {
		return fmt.Errorf("marshal touch payload: %w", err)
	}
	return d.writeControl(payload)
}

// SendKey forwards key control to ios-sim-server.
func (d *IOSSimulatorDevice) SendKey(ctx context.Context, key string) error {
	_ = ctx
	payload, err := json.Marshal(struct {
		Cmd string `json:"cmd"`
		Key string `json:"key"`
	}{
		Cmd: "key",
		Key: key,
	})
	if err != nil {
		return fmt.Errorf("marshal key payload: %w", err)
	}
	return d.writeControl(payload)
}

func (d *IOSSimulatorDevice) writeControl(payload []byte) error {
	d.writeMu.Lock()
	defer d.writeMu.Unlock()
	if err := conn.WriteControl(d.writer, payload); err != nil {
		return fmt.Errorf("write control: %w", err)
	}
	return nil
}

// ScreenSize returns the last known screen size.
func (d *IOSSimulatorDevice) ScreenSize() (width, height int32) {
	return d.width, d.height
}

// Close shuts down the daemon transport and subprocess.
func (d *IOSSimulatorDevice) Close() error {
	d.closeOnce.Do(func() {
		if d.writeCloser != nil {
			_ = d.writeCloser.Close()
		}
		if d.readCloser != nil {
			_ = d.readCloser.Close()
		}
		d.closeErr = d.closeFn()
	})
	return d.closeErr
}
