'use strict';

const Attributes = require('./Attributes');
const PlayerRace = require('../../gemstone3/bundles/input-events/lib/PlayerRace');
const Config = require('./Config');
const EffectList = require('./EffectList');
const { EquipSlotTakenError, EquipAlreadyEquippedError } = require('./EquipErrors');
const EventEmitter = require('events');
const Heal = require('./Heal');
const Metadatable = require('./Metadatable');
const { Inventory, InventoryFullError } = require('./Inventory');
const Logger = require('./Logger');


/**
 * The Character class acts as the base for both NPCs and Players.
 *
 * @property {string}     name       Name shown on look/who/login
 * @property {Inventory}  inventory
 * @property {Set}        combatants Enemies this character is currently in combat with
 * @property {number}     level
 * @property {Attributes} attributes
 * @property {EffectList} effects    List of current effects applied to the character
 * @property {Room}       room       Room the character is currently in
 *
 * @extends EventEmitter
 * @mixes Metadatable
 */
class Character extends Metadatable(EventEmitter) {
  constructor(data) {
    super();
    this.name = data.name;
    this.inventory = new Inventory(data.inventory || {});
    this.equipment = data.equipment || new Map();
    this.combatants = new Set();
    this.combatData = {};
    this.level = data.level || 1;
    this.room = data.room || null;
    this.attributes = data.attributes || new Attributes();
    this.stance = data.stance || 'neutral';

    this.followers = new Set();
    this.following = null;
    this.party = null;

    this.effects = new EffectList(this, data.effects);

    // Arbitrary data bundles are free to shove whatever they want in
    // WARNING: values must be JSON.stringify-able
    if (data.metadata) {
      this.metadata = JSON.parse(JSON.stringify(data.metadata));
    } else {
      this.metadata = {};
    }
  }

  /**
   * Proxy all events on the player to effects
   * @param {string} event
   * @param {...*}   args
   */
  emit(event, ...args) {
    super.emit(event, ...args);
    this.effects.emit(event, ...args);
  }

  /**
   * @param {string} attr Attribute name
   * @return {boolean}
   */
  hasAttribute(attr) {
    //console.log('this.attributes type: ', typeof(this.attributes));
    //console.log('Character.js: hasAttribute: ' + attr + ' ' + this.attributes.has(attr));
    return this.attributes.has(attr);
  }

  /**
   * Get current maximum value of attribute (as modified by effects.)
   * @param {string} attr
   * @return {number}
   */
  getMaxAttribute(attr) {
    if (!this.hasAttribute(attr)) {
      throw new RangeError(`Character does not have attribute [${attr}]`);
    }

    const attribute = this.attributes.get(attr);
    const currentVal = this.effects.evaluateAttribute(attribute);

    if (!attribute.formula) {
      return currentVal;
    }

    const { formula } = attribute;

    const requiredValues = formula.requires.map(
      reqAttr => this.getMaxAttribute(reqAttr)
    );

    return formula.evaluate.apply(formula, [attribute, this, currentVal, ...requiredValues]);
  }

  /**
   * @see {@link Attributes#add}
   */
  addAttribute(attribute) {
    this.attributes.add(attribute);
  }

  /**
   * Get the current value of an attribute (base modified by delta)
   * @param {string} attr
   * @return {number}
  */
  getAttribute(attr) {
    if (!this.hasAttribute(attr)) {
      throw new RangeError(`Character does not have attribute [${attr}]`);
    }

    return this.getMaxAttribute(attr) + this.attributes.get(attr).delta;
  }

  getStatBonus(attr, race) {
    let baseStat = this.getMaxAttribute(attr);
    let allRaceStatBonuses = PlayerRace.getRaces();
    let playerRaceBonuses = allRaceStatBonuses[race];
    let raceBonus = playerRaceBonuses.statBonusModifiers[attr];
    let bonus =((baseStat-50)/2) + (raceBonus);
    bonus = parseInt(bonus);
    return bonus;
  }

  /**
   * Get the bonus value of a skill (5 * ranks)
   * @param attr
   * @returns {number}
   */
  getSkillBonus(attr) {
    if (!this.hasAttribute(attr)) {
      throw new RangeError(`Character does not have the skill [${attr}]`);
    }

    let ranks = this.attributes.get(attr).base;
    if(ranks <= 10){
      return ranks * 5;
    }
    if(ranks > 10 && ranks <= 20) {
      let remainder = ranks - 10;
      return 50 + (remainder * 4);
    }
    if(ranks > 20 && ranks <= 30) {
      let remainder = ranks - 20;
      return 90 + (remainder * 3);
    }
    if(ranks > 30 && ranks <= 40) {
      let remainder = ranks - 30;
      return 120 + (remainder * 2);
    }
    if(ranks > 40) {
      let remainder = ranks - 40;
      return 140 + (remainder * 1);
    }
  }


  /**
   * Get the base value for a given attribute
   * @param {string} attr Attribute name
   * @return {number}
   */
  getBaseAttribute(attr) {
    var attr = this.attributes.get(attr);
    return attr && attr.base;
  }

  /**
   * Fired when a Character's attribute is set, raised, or lowered
   * @event Character#attributeUpdate
   * @param {string} attributeName
   * @param {Attribute} attribute
   */

  /**
   * Clears any changes to the attribute, setting it to its base value.
   * @param {string} attr
   * @fires Character#attributeUpdate
  */
  setAttributeToMax(attr) {
    if (!this.hasAttribute(attr)) {
      throw new Error(`Invalid attribute ${attr}`);
    }

    this.attributes.get(attr).setDelta(0);
    this.emit('attributeUpdate', attr, this.getAttribute(attr));
  }

  /**
   * Raise an attribute by name
   * @param {string} attr
   * @param {number} amount
   * @see {@link Attributes#raise}
   * @fires Character#attributeUpdate
  */
  raiseAttribute(attr, amount) {
    if (!this.hasAttribute(attr)) {
      throw new Error(`Invalid attribute ${attr}`);
    }

    this.attributes.get(attr).raise(amount);
    this.emit('attributeUpdate', attr, this.getAttribute(attr));
  }

  /**
   * Lower an attribute by name
   * @param {string} attr
   * @param {number} amount
   * @see {@link Attributes#lower}
   * @fires Character#attributeUpdate
  */
  lowerAttribute(attr, amount) {
    if (!this.hasAttribute(attr)) {
      throw new Error(`Invalid attribute ${attr}`);
    }

    this.attributes.get(attr).lower(amount);
    this.emit('attributeUpdate', attr, this.getAttribute(attr));
  }

  /**
   * Update an attribute's base value.
   *
   * NOTE: You _probably_ don't want to use this the way you think you do. You should not use this
   * for any temporary modifications to an attribute, instead you should use an Effect modifier.
   *
   * This will _permanently_ update the base value for an attribute to be used for things like a
   * player purchasing a permanent upgrade or increasing a stat on level up
   *
   * @param {string} attr Attribute name
   * @param {number} newBase New base value
   * @fires Character#attributeUpdate
   */
  setAttributeBase(attr, newBase) {
    console.log('Character.js: setAttributeBase: ' + attr + ' newBase: ' + newBase);
    console.log(typeof(this.attributes));
    if (!this.hasAttribute(attr)) {
      throw new Error(`Invalid attribute ${attr}`);
    }

    this.attributes.get(attr).setBase(newBase);
    this.emit('attributeUpdate', attr, this.getAttribute(attr));
  }

  /**
   * @param {string} type
   * @return {boolean}
   * @see {@link Effect}
   */
  hasEffectType(type) {
    return this.effects.hasEffectType(type);
  }

  /**
   * @param {Effect} effect
   * @return {boolean}
   */
  addEffect(effect) {
    return this.effects.add(effect);
  }

  /**
   * @param {Effect} effect
   * @see {@link Effect#remove}
   */
  removeEffect(effect) {
    this.effects.remove(effect);
  }

  /**
   * Start combat with a given target.
   * @param {Character} target
   * @param {?number}   lag    Optional milliseconds of lag to apply before the first attack
   * @fires Character#combatStart
   */
  initiateCombat(target, lag = 0) {
    if (!this.isInCombat()) {
      this.combatData.lag = lag;
      this.combatData.roundStarted = Date.now();
      Logger.verbose(`[Character.js] ${this.name} has Lag:${this.combatData.lag} after attacking ${target.name}`);
      //Logger.verbose(`[Character.js] ${this.name} has Round started:${this.combatData.roundStarted}`);

      //Logger.verbose(`[Character.js] Combat started for ${this.name} with ${target.name}`);
      /**
       * Fired when Character#initiateCombat is called
       * @event Character#combatStart
       */
      this.emit('combatStart');
    }

    if (this.isInCombat(target)) {
      return;
    }

    // this doesn't use `addCombatant` because `addCombatant` automatically
    // adds this to the target's combatants list as well
    this.combatants.add(target);
    if (!target.isInCombat()) {
      // TODO: This hardcoded 2.5 second lag on the target needs to be refactored
      target.initiateCombat(this, 5000);
    }

    target.addCombatant(this);
  }

  /**
   * Check to see if this character is currently in combat or if they are
   * currently in combat with a specific character
   * @param {?Character} target
   * @return boolean
   */
  isInCombat(target) {
    return target ? this.combatants.has(target) : this.combatants.size > 0;
  }

  /**
   * @param {Character} target
   * @fires Character#combatantAdded
   */
  addCombatant(target) {
    if (this.isInCombat(target)) {
      return;
    }

    this.combatants.add(target);
    target.addCombatant(this);
    /**
     * @event Character#combatantAdded
     * @param {Character} target
     */
    this.emit('combatantAdded', target);
  }

  /**
   * @param {Character} target
   * @fires Character#combatantRemoved
   * @fires Character#combatEnd
   */
  removeCombatant(target) {
    if (!this.combatants.has(target)) {
      return;
    }

    this.combatants.delete(target);
    target.removeCombatant(this);
    //target.combatData.lag = 0;
    //target.combatData.lagRemaining = 0;

    /**
     * @event Character#combatantRemoved
     * @param {Character} target
     */
    this.emit('combatantRemoved', target);

    if (!this.combatants.size) {
      /**
       * @event Character#combatEnd
       */
      this.emit('combatEnd');
    }

  }

  /**
   * Fully remove this character from combat
   */
  removeFromCombat() {
    if (!this.isInCombat()) {
      return;
    }

    for (const combatant of this.combatants) {
      // Reset player lag
      //this.combatData.lag = 0;
      this.removeCombatant(combatant);
    }
  }

  /**
   * @see EffectList.evaluateIncomingDamage
   * @param {Damage} damage
   * @return {number}
   */
  evaluateIncomingDamage(damage, currentAmount) {
    let amount = this.effects.evaluateIncomingDamage(damage, currentAmount);
    return Math.floor(amount);
  }

  /**
   * @see EffectList.evaluateOutgoingDamage
   * @param {Damage} damage
   * @param {number} currentAmount
   * @return {number}
   */
  evaluateOutgoingDamage(damage, currentAmount) {
    return this.effects.evaluateOutgoingDamage(damage, currentAmount);
  }

  /**
   * @param {Item} item
   * @param {string} slot Slot to equip the item in
   *
   * @throws EquipSlotTakenError
   * @throws EquipAlreadyEquippedError
   * @fires Character#equip
   * @fires Item#equip
   */
  equip(item, slot) {
    if (this.equipment.has(slot)) {
      throw new EquipSlotTakenError();
    }

    if (item.isEquipped) {
      throw new EquipAlreadyEquippedError();
    }

    if (this.inventory) {
      this.removeItem(item);
    }

    this.equipment.set(slot, item);
    item.isEquipped = true;
    item.equippedBy = this;
    /**
     * @event Item#equip
     * @param {Character} equipper
     */
    item.emit('equip', this);
    /**
     * @event Character#equip
     * @param {string} slot
     * @param {Item} item
     */
    this.emit('equip', slot, item);
  }

  /**
   * Remove equipment in a given slot and move it to the character's inventory
   * @param {string} slot
   *
   * @throws InventoryFullError
   * @fires Item#unequip
   * @fires Character#unequip
   */
  unequip(slot) {
    if (this.isInventoryFull()) {
      throw new InventoryFullError();
    }

    const item = this.equipment.get(slot);
    item.isEquipped = false;
    item.equippedBy = null;
    this.equipment.delete(slot);
    /**
     * @event Item#unequip
     * @param {Character} equipper
     */
    item.emit('unequip', this);
    /**
     * @event Character#unequip
     * @param {string} slot
     * @param {Item} item
     */
    this.emit('unequip', slot, item);
    this.addItem(item);
  }

  /**
   * Move an item to the character's inventory
   * @param {Item} item
   */
  addItem(item) {
    //console.log('Character.js: addItem: ' + item.name + ' added to ' + this.name + ' inventory');
    this._setupInventory();
    this.inventory.addItem(item);
    item.carriedBy = this;
  }

  /**
   * Remove an item from the character's inventory. Warning: This does not automatically place the
   * item in any particular place. You will need to manually add it to the room or another
   * character's inventory
   * @param {Item} item
   */
  removeItem(item) {
    this.inventory.removeItem(item);

    // if we removed the last item unset the inventory
    // This ensures that when it's reloaded it won't try to set
    // its default inventory. Instead it will persist the fact
    // that all the items were removed from it
    if (!this.inventory.size) {
      this.inventory = null;
    }
    item.carriedBy = null;
  }

  /**
   * Check to see if this character has a particular item by EntityReference
   * @param {EntityReference} itemReference
   * @return {Item|boolean}
   */
  hasItem(itemReference) {
    for (const [ uuid, item ] of this.inventory) {
      if (item.entityReference === itemReference) {
        return item;
      }
    }

    return false;
  }

  /**
   * @return {boolean}
   */
  isInventoryFull() {
    this._setupInventory();
    return this.inventory.isFull;
  }

  /**
   * @private
   */
  _setupInventory() {
    this.inventory = this.inventory || new Inventory();
    console.log('This inventory ', this.inventory);
    //console.log('this.inventory.getMax(): ', this.inventory.getMax());
    // Default max inventory size config
    if (!this.isNpc) {
      //this.inventory.setMax(Config.get('defaultMaxPlayerInventory') || 2);
      //console.log(this.name + ' inventory size: ' + this.inventory.size + '/' + this.inventory.maxSize);
      this.inventory.maxSize = 2;
      //console.log(this.name + 'inventory size: ' + this.inventory.size + '/' + this.inventory.maxSize);
    }
  }

  /**
   * Begin following another character. If the character follows itself they stop following.
   * @param {Character} target
   */
  follow(target) {
    if (target === this) {
      this.unfollow();
      return;
    }

    this.following = target;
    target.addFollower(this);
    /**
     * @event Character#followed
     * @param {Character} target
     */
    this.emit('followed', target);
  }

  /**
   * Stop following whoever the character was following
   * @fires Character#unfollowed
   */
  unfollow() {
    this.following.removeFollower(this);
    /**
     * @event Character#unfollowed
     * @param {Character} following
     */
    this.emit('unfollowed', this.following);
    this.following = null;
  }

  /**
   * @param {Character} follower
   * @fires Character#gainedFollower
   */
  addFollower(follower) {
    this.followers.add(follower);
    follower.following = this;
    /**
     * @event Character#gainedFollower
     * @param {Character} follower
     */
    this.emit('gainedFollower', follower);
  }

  /**
   * @param {Character} follower
   * @fires Character#lostFollower
   */
  removeFollower(follower) {
    this.followers.delete(follower);
    follower.following = null;
    /**
     * @event Character#lostFollower
     * @param {Character} follower
     */
    this.emit('lostFollower', follower);
  }

  /**
   * @param {Character} target
   * @return {boolean}
   */
  isFollowing(target) {
    return this.following === target;
  }

  /**
   * @param {Character} target
   * @return {boolean}
   */
  hasFollower(target) {
    return this.followers.has(target);
  }

  /**
   * Initialize the character from storage
   * @param {GameState} state
   */
  hydrate(state) {
    if (this.__hydrated) {
      Logger.warn('Attempted to hydrate already hydrated character.');
      return false;
    }

    if (!(this.attributes instanceof Attributes)) {
      const attributes = this.attributes;
      this.attributes = new Attributes();

      for (const attr in attributes) {
        let attrConfig = attributes[attr];
        if (typeof attrConfig === 'number') {
          attrConfig = { base: attrConfig };
        }

        if (typeof attrConfig !== 'object' || !('base' in attrConfig)) {
          throw new Error('Invalid base value given to attributes.\n' + JSON.stringify(attributes, null, 2));
        }

        if (!state.AttributeFactory.has(attr)) {
          throw new Error(`Entity trying to hydrate with invalid attribute ${attr}`);
        }

        this.addAttribute(state.AttributeFactory.create(attr, attrConfig.base, attrConfig.delta || 0));
      }
    }

    this.effects.hydrate(state);

    // inventory is hydrated in the subclasses because npc and players hydrate their inventories differently

    this.__hydrated = true;
  }

  /**
   * Gather data to be persisted
   * @return {Object}
   */
  serialize() {
    return {
      attributes: this.attributes.serialize(),
      level: this.level,
      name: this.name,
      room: this.room.entityReference,
      effects: this.effects.serialize(),
    };
  }

  /**
   * @see {@link Broadcast}
   */
  getBroadcastTargets() {
    return [this];
  }

  /**
   * @return {boolean}
   */
  get isNpc() {
    return false;
  }
}

module.exports = Character;
