import { HasId, OmitId, Encodable, Decodable, OptionalIdStorable, Storable, PartialStorable, QueryKey, DocumentSnapshot, WhereFilterOp, FieldPath, OrderByDirection, QuerySnapshot, CollectionReference, DocumentReference } from './types'
import { Context } from './context'
import { Converter } from './converter'
import { Query } from './query'

export class Collection<T extends HasId, S = OmitId<T>> {
  context: Context
  collectionRef: CollectionReference
  private converter: Converter<T, S>

  constructor ({ context, path, encode, decode }: {
    context: Context,
    path: string,
    encode?: Encodable<T, S>,
    decode?: Decodable<T, S>,
  }) {
    this.context = context
    this.collectionRef = context.firestore.collection(path)
    this.converter = new Converter({ encode, decode })
  }

  toObject (documentSnapshot: DocumentSnapshot): T {
    return this.converter.decode(documentSnapshot)
  }

  docRef (id?: string): DocumentReference {
    if (id) return this.collectionRef.doc(id)
    return this.collectionRef.doc()
  }

  async fetch (id: string): Promise <T | undefined> {
    const docRef = this.docRef(id)
    const snapshot = (this.context.tx)
      ? await this.context.tx.get(docRef)
      : await docRef.get()
    if (!snapshot.exists) return undefined

    return this.toObject(snapshot)
  }

  async fetchAll (): Promise<T[]> {
    if (this.context.tx) throw new Error('Web SDK transaction.get() does not support QuerySnapshot')

    const snapshot = await this.collectionRef.get()
    return snapshot.docs.map((snapshot) => this.toObject(snapshot))
  }

  async add (obj: OptionalIdStorable<T>): Promise<string> {
    let docRef: DocumentReference
    const doc = this.converter.encode(obj)

    if (this.context.tx) {
      docRef = this.docRef()
      this.context.tx.set(docRef, doc)
    } else if (this.context.batch) {
      docRef = this.docRef()
      this.context.batch.set(docRef, doc)
    } else {
      docRef = await this.collectionRef.add(doc)
    }
    return docRef.id
  }

  async set (obj: Storable<T>): Promise<string> {
    if (!obj.id) throw new Error('Argument object must have "id" property')

    const docRef = this.docRef(obj.id)
    const setDoc = this.converter.encode(obj)

    if (this.context.tx) {
      this.context.tx.set(docRef, setDoc)
    } else if (this.context.batch) {
      this.context.batch.set(docRef, setDoc)
    } else {
      await docRef.set(setDoc)
    }
    return obj.id
  }

  addOrSet (obj: OptionalIdStorable<T>): Promise<string> {
    if ('id' in obj) {
      return this.set(obj as Storable<T>)
    }
    return this.add(obj)
  }

  async update (obj: PartialStorable<S & HasId>): Promise<string> {
    if (!obj.id) throw new Error('Argument object must have "id" property')

    const docRef = this.docRef(obj.id)
    // Copy obj with exclude 'id' key
    const { id, ...updateDoc } = { ...obj }

    if (this.context.tx) {
      this.context.tx.update(docRef, updateDoc)
    } else if (this.context.batch) {
      this.context.batch.update(docRef, updateDoc)
    } else {
      await docRef.update(updateDoc)
    }
    return obj.id
  }

  async delete (id: string): Promise<string> {
    const docRef = this.docRef(id)
    if (this.context.tx) {
      this.context.tx.delete(docRef)
    } else if (this.context.batch) {
      this.context.batch.delete(docRef)
    } else {
      await docRef.delete()
    }
    return id
  }

  async bulkAdd (objects: Array<OptionalIdStorable<T>>): Promise<void> {
    return this.context.runBatch(async () => {
      for (const obj of objects) {
        await this.add(obj)
      }
    })
  }

  async bulkSet (objects: Array<Storable<T>>): Promise<void> {
    return this.context.runBatch(async () => {
      for (const obj of objects) {
        await this.set(obj)
      }
    })
  }

  async bulkDelete (docIds: string[]): Promise<void> {
    return this.context.runBatch(async () => {
      for (const docId of docIds) {
        await this.delete(docId)
      }
    })
  }

  where (fieldPath: QueryKey<S>, opStr: WhereFilterOp, value: any): Query<T, S> {
    const query = this.collectionRef.where(fieldPath as string | FieldPath, opStr, value)
    return new Query<T, S>(this.converter, this.context, query)
  }

  orderBy (fieldPath: QueryKey<S>, directionStr?: OrderByDirection): Query<T, S> {
    const query = this.collectionRef.orderBy(fieldPath as string | FieldPath, directionStr)
    return new Query<T, S>(this.converter, this.context, query)
  }

  limit (limit: number): Query<T, S> {
    const query = this.collectionRef.limit(limit)
    return new Query<T, S>(this.converter, this.context, query)
  }

  onSnapshot (callback: (
    querySnapshot: QuerySnapshot,
    toObject: (documentSnapshot: DocumentSnapshot) => T
    ) => void
  ): () => void {
    return this.collectionRef.onSnapshot((_querySnapshot) => {
      callback(_querySnapshot, this.toObject.bind(this))
    })
  }
}
