package repository

import (
	"github.com/fjutian/nwd-admin/internal/model"
)

// PluginRepository is the data-access contract for plugins.
type PluginRepository interface {
	Count() (int64, error)
	SumDownloads() (int64, error)
	CountSince(days int) (int64, error)
	ListRecent(limit int) ([]model.Plugin, error)
	ListAll() ([]model.Plugin, error)
	FindByID(id string) (*model.Plugin, error)
	Save(p *model.Plugin) error
	IncrementDownloads(id string) error
	Delete(id string) error
}
