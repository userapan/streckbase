import { Mapper, subset } from "@helpers";
import { User as DBUser } from "@repositories/user/user";
import { UserRepository } from "@repositories/user/user.repository";
import { PurchaseRepository } from "@repositories/purchase/purchase.repository";
import { Purchase } from "@services/purchase/purchase";
import { Purchase as DBPurchase } from "@repositories/purchase/purchase";
import { ItemRepository } from "@repositories/item/item.repository";
import { Item as DBItem } from "@repositories/item/item";
import { Item } from "./../item/item";
import { User } from "./user";

export class UserService {
  private userRepository: UserRepository;
  private purchaseRepository: PurchaseRepository;
  private itemRepository: ItemRepository;

  constructor() {
    this.userRepository = new UserRepository();
    this.purchaseRepository = new PurchaseRepository();
    this.itemRepository = new ItemRepository();
  }

  private mapUser(dbUser: DBUser): User {
    const userMapper: Mapper<DBUser, User> = new Mapper(DBUser, User);
    if (!dbUser) return null;

    return userMapper
      .createMap(dbUser)
      .forMember((dbUser) => <Partial<User>>{
        id: dbUser.user_id,
        lobare: !!dbUser.lobare,
        admin: !!dbUser.admin
      })
      .map();
  }

  private mapPurchase(dbPurchase: DBPurchase): Purchase {
    const purchaseMapper: Mapper<DBPurchase, Purchase> = new Mapper(DBPurchase, Purchase);
    const itemMapper: Mapper<DBItem, Item> = new Mapper(DBItem, Item);

    return purchaseMapper
      .createMap(dbPurchase)
      .forMember((dbPurchase: DBPurchase) => {
        if (!dbPurchase) return null;

        const item: Item = itemMapper
          .createMap(<DBItem>subset(DBItem, dbPurchase))
          .forMember((dbItem: DBItem) => <Partial<Item>>{
            id: dbItem.item_id,
            barcodes: dbItem.codes ? dbItem.codes.split(",") : [],
          })
          .map();

        const purchase: Partial<Purchase> = {
          item,
          totalCount: dbPurchase.total
        };

        return purchase;
      })
      .map();
  }

  getUser(id: string): Promise<User> {
    return this.userRepository.getUser(id)
      .then((dbUser: DBUser) => this.mapUser(dbUser));
  }

  getUsers(limit: number, offset: number): Promise<User[]> {
    return this.userRepository.getUsers(limit, offset)
      .then((dbUsers: DBUser[]) => dbUsers.map<User>((dbUser: DBUser) => this.mapUser(dbUser)));
  }

  getUserPurchase(userId: string, purchaseId: number): Promise<User> {
    let currentUser: User;

    return this.getUser(userId)
      .then((user: User) => {
        if (!user) return null;
        currentUser = user;

        return this.purchaseRepository.getPurchase(purchaseId)
      })
      .then((dbPurchase: DBPurchase) => {
        if (!dbPurchase) return null;
        currentUser.purchases = <Purchase[]>[this.mapPurchase(dbPurchase)];
        return currentUser;
      });
  }

  getUserPurchases(userId: string, limit: number, offset: number): Promise<User> {
    let currentUser: User;

    return this.getUser(userId)
      .then((user: User) => {
        if (!user) return null;
        currentUser = user;

        return this.purchaseRepository.getUserPurchases(userId, limit, offset)
      })
      .then((purchases: DBPurchase[]) => {
        currentUser.purchases = <Purchase[]>purchases
          .map<Purchase>((dbPurchase: DBPurchase) => this.mapPurchase(dbPurchase));

        return currentUser;
      });
  }

  createUser(user: User): Promise<User> {
    return this.userRepository.createUser(user)
      .then(() => {
        user.debt = 0;
        return user;
      });
  }

  updateUser(user: User): Promise<User> {
    return this.userRepository.updateUser(user)
      .then(() => this.getUser(user.id));
  }

  createPurchase(userId: string, item: Item): Promise<User> {
    if (!(userId && item && item.id)) return null;

    let user: User;
    return this.getUser(userId)
      .then((u: User) => {
        user = u;
        return this.itemRepository.getItem(item.id)
      })
      .then((dbItem: DBItem) => {
        const realItem = new Mapper<DBItem, Item>(DBItem, Item)
          .createMap(dbItem)
          .forMember((dbItem) => <Partial<Item>>{
            id: dbItem.item_id,
            barcodes: dbItem.codes ? dbItem.codes.split(",") : []
          })
          .map();

        user.debt += realItem.price;
        return this.purchaseRepository.createPurchase(userId, item.id);
      })
      .then(() => {
        return this.userRepository.updateDebt(userId, user.debt);
      })
      .then(() => {
        return this.purchaseRepository.getLatestUserPurchase(userId);
      })
      .then((dbPurchase: DBPurchase) => {
        user.purchases = <Purchase[]>[this.mapPurchase(dbPurchase)];
        return user;
      });
  }

  getFeedPurchases(limit: number, offset: number): Promise<User[]> {
    return this.purchaseRepository.getFeedPurchases(limit, offset)
      .then((results: DBPurchase[] & DBUser[]) => {
        return results.map((result: DBPurchase & DBUser) => {
          const user: User = this.mapUser(subset(DBUser, result));
          user.purchases = [this.mapPurchase(subset(DBPurchase, result))];

          return user;
        });
      });
  }

  deleteUserPurchase(userId: string, purchaseId: number): Promise<any> {
    let price: number;
    let debt: number;

    return this.userRepository.getUser(userId)
      .then((user: DBUser) => {
        debt = user.debt;
        return this.purchaseRepository.getPurchase(purchaseId);
      })
      .then((dbPurchase: DBPurchase) => {
        if (!dbPurchase) throw new Error("Item not found");
        price = dbPurchase.price;
        return this.purchaseRepository.deletePurchase(purchaseId)
      })
      .then(() => this.userRepository.updateDebt(userId, debt - price))
  };

  getMonthlyHighscore(): Promise<User[]> {
    return this.userRepository.getMonthlyHighscore()
      .then((dbUsers: DBUser[]) => dbUsers.map<User>((dbUser: DBUser) => this.mapUser(dbUser)));
  }

}
