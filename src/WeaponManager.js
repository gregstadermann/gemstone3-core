'use strict';

class WeaponManager {
    constructor() {
        this.results = new Set();
        this.loader = null;
    }

    setLoader(loader) {
        this.loader = loader;
    }

    async lookup(weaponBase, total) {
        if (!this.loader) {
            throw new Error('No entity loader configured for weapons');
        }

        const allResults = await this.loader.fetchAll('weapons');
        //console.log(allResults);
        for (const result of allResults) {
            if (result.RollRangeStart <= total && result.RollRangeEnd >= total) {
                return result;
            }
        }
        return '';
    }

    async loadAllWeapons(weaponBase, RollRangeStart, RollRangeEnd) {
        if (!this.loader) {
            throw new Error('No entity loader configured for weapons');
        }
        const data = await this.loader.fetchAll('weapons');
        for (const weapons of data) {
            this.results.add(weapons);
        }


    }
}
module.exports = WeaponManager;
