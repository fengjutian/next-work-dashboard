package repository

import (
	"time"

	"github.com/fjutian/nwd-admin/internal/model"
	"gorm.io/gorm"
)

type gormPluginRepo struct {
	db *gorm.DB
}

func NewPluginRepository(db *gorm.DB) PluginRepository {
	return &gormPluginRepo{db: db}
}

func (r *gormPluginRepo) Count() (int64, error) {
	var n int64
	err := r.db.Model(&model.Plugin{}).Count(&n).Error
	return n, err
}

func (r *gormPluginRepo) SumDownloads() (int64, error) {
	var n int64
	err := r.db.Model(&model.Plugin{}).Select("COALESCE(SUM(downloads), 0)").Scan(&n).Error
	return n, err
}

func (r *gormPluginRepo) CountSince(days int) (int64, error) {
	var n int64
	err := r.db.Model(&model.Plugin{}).Where("created_at >= ?", time.Now().AddDate(0, 0, -days)).Count(&n).Error
	return n, err
}

func (r *gormPluginRepo) ListRecent(limit int) ([]model.Plugin, error) {
	var plugins []model.Plugin
	err := r.db.Order("created_at DESC").Limit(limit).Find(&plugins).Error
	return plugins, err
}

func (r *gormPluginRepo) ListAll() ([]model.Plugin, error) {
	var plugins []model.Plugin
	err := r.db.Order("updated_at DESC").Find(&plugins).Error
	return plugins, err
}

func (r *gormPluginRepo) FindByID(id string) (*model.Plugin, error) {
	var p model.Plugin
	err := r.db.First(&p, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *gormPluginRepo) Save(p *model.Plugin) error {
	return r.db.Save(p).Error
}

func (r *gormPluginRepo) IncrementDownloads(id string) error {
	return r.db.Model(&model.Plugin{}).Where("id = ?", id).
		UpdateColumn("downloads", gorm.Expr("downloads + 1")).Error
}

func (r *gormPluginRepo) Delete(id string) error {
	return r.db.Delete(&model.Plugin{}, "id = ?", id).Error
}
