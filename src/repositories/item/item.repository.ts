import { MysqlError, PoolConnection } from "mysql";
import dbConnection from "@config/dbConnection";

import { BaseRepository } from "./../base.repository";
import { Item } from "./item";
import { Item as APIItem } from "@services/item/item";

export class ItemRepository extends BaseRepository {
  constructor() {
    super();
  }

  getItem(id: number): Promise<Item> {
    if (!id && id !== 0) return null;

    return this.dbQuery(`
      SELECT Items.item_id, name, price, volume, alcohol, group_concat(code) AS codes, systembolaget_id, Images.thumbnail, Images.large AS image
      FROM Items
      LEFT JOIN Barcodes ON Barcodes.item_id = Items.item_id
      LEFT JOIN Images ON Images.item_id = Items.item_id
      WHERE Items.item_id = ?
      GROUP BY Items.item_id
      ORDER BY Items.item_id
    `, [id])
      .then((res: any[]) => res[0]);
  }

  getBarcodeItem(barcode: string): Promise<Item> {
    barcode = `%${barcode}%`;
    return this.dbQuery("SELECT item_id AS id FROM Barcodes WHERE code LIKE ?", [barcode])
      .then((res: any[]) => res[0] && res[0].id ? res[0].id : null)
      .then((id: number) => this.getItem(id));
  }

  getLatestId(): Promise<number> {
    return this.dbQuery("SELECT MAX(item_id) as id FROM Items")
      .then((res: any[]) => res[0].id);
  }

  getItems(limit: number, offset: number): Promise<Item[]> {
    return this.dbQuery(`
      SELECT Items.item_id, name, price, volume, alcohol, group_concat(code) AS codes, systembolaget_id, Images.thumbnail, Images.large AS image
      FROM Items
      LEFT JOIN Barcodes ON Barcodes.item_id = Items.item_id
      LEFT JOIN Images ON Images.item_id = Items.item_id
      GROUP BY Items.item_id
      ORDER BY Items.item_id
      DESC
      LIMIT ?
      OFFSET ?
    `, [limit, offset]);
  }

  getPopularItems(limit: number): Promise<Item[]> {
    return this.dbQuery(`
      SELECT i.item_id, i.name, i.price, i.volume, i.alcohol, i.systembolaget_id, img.thumbnail, img.large AS image,
      (
        SELECT group_concat(b.code) FROM Barcodes b WHERE b.item_id = i.item_id
      ) AS codes
      FROM Purchases p
      JOIN Items i ON i.item_id = p.item_id
      LEFT JOIN Images img ON img.item_id = i.item_id
      WHERE p.date >= DATE(NOW()) - INTERVAL 1 MONTH
      GROUP BY p.item_id
      ORDER BY COUNT(p.item_id)
      DESC
      LIMIT ?
    `, [limit]);
  }

  createItem(item: APIItem): Promise<any> {
    const barcodes: string = item.barcodes.map((barcode: string) => barcode.trim()).join();
    let id: number;

    return new Promise((resolve, reject) => {
      dbConnection.getConnection((err: MysqlError, connection: PoolConnection) => {
        if (err) return reject(err);

        this.beginTransaction(connection)
          .then(() => this.poolQuery(connection, `
              INSERT INTO Items (name, price, volume, alcohol) VALUES (?, ?, ?, ?)
            `, [item.name, item.price, item.volume, item.alcohol])
          )
          .then((results: any) => {
            id = results.insertId;
            return this.poolQuery(connection, `
              INSERT INTO Barcodes (code, item_id) VALUES (?, ?)
            `, [barcodes, id]);
          })
          .then(() => {
            if (!item.imageUrl) {
              return new Promise((resolve) => resolve());
            } else {
              return this.poolQuery(connection, `
                INSERT INTO Images (item_id, large) VALUES (?, ?)
              `, [id, item.imageUrl]);
            }
          })
          .then(() => this.commit(connection))
          .then(() => resolve())
          .catch((err: MysqlError) => {
            connection.rollback(() => {
              connection.release();
              reject(err);
            });
          })
      });
    });
  }

  updateItem(item: APIItem): Promise<any> {
    return this.dbQuery(`
      UPDATE Items i, Barcodes b
      SET i.name = ?, i.price = ?, i.volume = ?, i.alcohol = ?, b.code = ?
      WHERE i.item_id = b.item_id AND i.item_id = ?
    `, [item.name, item.price, item.volume, item.alcohol, item.barcodes.join(), item.id]);
  }

  deleteItem(id: number): Promise<any> {
    return this.dbQuery(`
      DELETE FROM Items WHERE item_id = ?
    `, [id]);
  }

}
