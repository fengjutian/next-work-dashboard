package service

import (
	"fmt"
	"log/slog"

	"github.com/fjutian/nwd-admin/internal/model"
	"github.com/fjutian/nwd-admin/internal/repository"
)

type PluginService struct {
	repo repository.PluginRepository
}

func NewPluginService(repo repository.PluginRepository) *PluginService {
	return &PluginService{repo: repo}
}

func (s *PluginService) DashboardStats() (pluginCount, totalDownloads, recentCount int64, recent []model.Plugin) {
	var err error
	pluginCount, err = s.repo.Count()
	if err != nil {
		slog.Warn("count plugins", "err", err)
	}
	totalDownloads, err = s.repo.SumDownloads()
	if err != nil {
		slog.Warn("sum downloads", "err", err)
	}
	recentCount, err = s.repo.CountSince(7)
	if err != nil {
		slog.Warn("count recent", "err", err)
	}
	recent, err = s.repo.ListRecent(10)
	if err != nil {
		slog.Warn("list recent", "err", err)
	}
	return
}

func (s *PluginService) List() ([]model.Plugin, error) {
	plugins, err := s.repo.ListAll()
	if err != nil {
		return nil, fmt.Errorf("list plugins: %w", err)
	}
	if plugins == nil {
		plugins = []model.Plugin{}
	}
	return plugins, nil
}

func (s *PluginService) Publish(p *model.Plugin) error {
	if err := s.repo.Save(p); err != nil {
		return fmt.Errorf("save plugin %q: %w", p.ID, err)
	}
	slog.Info("plugin published", "id", p.ID, "version", p.Version)
	return nil
}

func (s *PluginService) Download(id string) (*model.Plugin, error) {
	p, err := s.repo.FindByID(id)
	if err != nil {
		return nil, fmt.Errorf("find plugin %q: %w", id, err)
	}
	if err := s.repo.IncrementDownloads(id); err != nil {
		slog.Warn("increment downloads", "id", id, "err", err)
	}
	return p, nil
}

func (s *PluginService) Remove(id string) error {
	if err := s.repo.Delete(id); err != nil {
		return fmt.Errorf("delete plugin %q: %w", id, err)
	}
	slog.Info("plugin removed", "id", id)
	return nil
}
