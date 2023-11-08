'use strict';

class CritsCrushManager{
    constructor(){
        this.crits = new Set();
        this.loader = null;
    }

    setLoader(loader){
        this.loader = loader;
    }

    async loadCritical(RollResult){
        if (!this.loader) {
            throw new Error('No entity loader configured for critsCrush');
        }

        const allCriticals = await this.loader.fetchAll('critsCrush');
        //console.log(allCriticals);

        for(const crit of allCriticals) {
            if(crit.RollRangeStart <= RollResult && crit.RollRangeEnd >= RollResult){
                console.log(crit);
                return crit;
            }
        }
        return null;
    }

    async loadAllCriticals(RollRangeStart, RollRangeEnd){
        if (!this.loader) {
            throw new Error('No entity loader configured for critsCrush');
        }
        const data = await this.loader.fetchAll('critsCrush');
        for (const crits of data) {
            this.crits.add(crits);
        }
        console.log(this.crits);
    }
}
module.exports = CritsCrushManager;
