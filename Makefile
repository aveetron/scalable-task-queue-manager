.PHONY: dev

dev:
	yarn migration:run && yarn start:dev
